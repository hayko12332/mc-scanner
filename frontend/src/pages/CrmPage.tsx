import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { CarriersView, DispatchersView } from '../components/crm/PeopleViews'
import { LoadDrawer } from '../components/crm/LoadDrawer'
import { LoadsTable } from '../components/crm/LoadsTable'
import { SignIn } from '../components/crm/SignIn'
import { Icon } from '../components/Icon'
import { track } from '../lib/analytics'
import { crm, CrmError, type CrmConfig, type CrmState, type CrmUser, type Load, type LoadInput } from '../lib/crm'
import { crmDemo } from '../lib/crmDemo'

type Tab = 'loads' | 'carriers' | 'dispatchers'
type Theme = 'light' | 'dark'

const THEME_KEY = 'leadhaul.work.theme'
const DEMO_KEY = 'leadhaul.dispatchDemo.on'
const readDemo = () => { try { return localStorage.getItem(DEMO_KEY) === '1' } catch { return false } }
const writeDemo = (on: boolean) => { try { if (on) localStorage.setItem(DEMO_KEY, '1'); else localStorage.removeItem(DEMO_KEY) } catch { /* not remembered */ } }
const readTheme = (): Theme => {
  try {
    return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

/** Full-screen work layout: its own slim top bar instead of the site header, light theme by default. */
function Shell({ theme, setTheme, children, nav, user, banner }: {
  theme: Theme; setTheme: (t: Theme) => void; children: ReactNode; nav?: ReactNode; user?: ReactNode; banner?: ReactNode
}) {
  return (
    <div className={`work theme-${theme}`}>
      <header className="w-top">
        <a href="#/" className="w-brand" title="LeadHaul home">
          <img src="/logo.svg" alt="" width="22" height="22" />
          <b>LeadHaul</b><span>Dispatch</span>
        </a>
        {nav}
        <div className="w-right">
          <a className="w-link" href="#/leads"><Icon name="zap" size={14} />MC leads</a>
          <a className="w-link" href="#/lookup"><Icon name="search" size={14} />Lookup</a>
          <button className="w-icon" title={theme === 'light' ? 'Dark theme' : 'Light theme'} aria-label="Switch theme"
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
            {theme === 'light' ? '☾' : '☀'}
          </button>
          {user}
        </div>
      </header>
      {banner}
      <div className="w-body">{children}</div>
    </div>
  )
}

/** Dispatch board (TMS): sign in with Google, then the load journal, carriers and dispatchers. */
export function CrmPage({ toast }: { toast: (m: string) => void }) {
  const [config, setConfig] = useState<CrmConfig | null>(null)
  const [state, setState] = useState<CrmState | null>(null)
  const [signedOut, setSignedOut] = useState(false)
  const [tab, setTab] = useState<Tab>('loads')
  /** Load open in the side panel. */
  const [openId, setOpenId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [theme, setThemeState] = useState<Theme>(readTheme)
  const [demo, setDemoState] = useState(readDemo)
  const api = demo ? crmDemo : crm
  const setDemo = (on: boolean) => { writeDemo(on); setDemoState(on); setState(null) }
  const setTheme = (t: Theme) => {
    setThemeState(t)
    try { localStorage.setItem(THEME_KEY, t) } catch { /* the choice just isn't remembered */ }
  }

  const reload = useCallback(() => (demo ? crmDemo : crm).state().then((s) => { setState(s); setSignedOut(false) }, (e: CrmError) => {
    if (e.status === 401) setSignedOut(true)
    else setError(e.message)
  }), [demo])

  useEffect(() => {
    crm.config().then(setConfig, (e: Error) => setError(e.message))
    void reload()
  }, [reload])

  const onSignedIn = useCallback((u: CrmUser) => {
    track('crm_sign_in', { email_domain: u.email.split('@')[1] ?? '' })
    void reload()
  }, [reload])

  /** Runs a change, shows errors as a toast, then refreshes from the server so totals always match it. */
  const act = useCallback(async (fn: () => Promise<unknown>, done?: string) => {
    try {
      await fn()
      if (done) toast(done)
    } catch (e) {
      toast((e as Error).message)
      throw e
    } finally {
      await reload()
    }
  }, [reload, toast])

  /**
   * Instant edits: the table and totals change right away, the server is told in the background.
   * If the server refuses, the error shows and the board reloads the real data.
   */
  const optimistic = useCallback(async (local: (s: CrmState) => CrmState, remote: () => Promise<unknown>, done?: string) => {
    setState((s) => (s ? local(s) : s))
    if (done) toast(done)
    try {
      return await remote()
    } catch (e) {
      toast((e as Error).message)
      await reload()
      throw e
    }
  }, [reload, toast])

  const patchLoads = (ids: Set<number>, patch: (l: Load) => Load) => (s: CrmState) => ({ ...s, loads: s.loads.map((l) => (ids.has(l.id) ? patch(l) : l)) })
  const updateLoad = (id: number, l: LoadInput) => optimistic(patchLoads(new Set([id]), () => ({ ...l, id })), () => api.updateLoad(id, l))
  const addLoad = async (l: LoadInput) => {
    const tempId = -Date.now()
    const saved = await optimistic((s) => ({ ...s, loads: [{ ...l, id: tempId }, ...s.loads] }), () => api.addLoad(l)) as Load
    setState((s) => (s ? { ...s, loads: s.loads.map((x) => (x.id === tempId ? saved : x)) } : s))
  }

  const closeLoad = useCallback(() => setOpenId(null), [])

  const banner = demo && state ? (
    <div className="w-demo">
      <b>Demo</b> Sample data, saved only in this browser. Try anything — add loads, change statuses, import your sheet.
      <button className="w-link" onClick={() => { crmDemo.reset(); void reload() }}>Reset demo</button>
      <button className="primary" onClick={() => setDemo(false)}>Sign in to use it for real</button>
    </div>
  ) : null
  const shell = (children: ReactNode, nav?: ReactNode, user?: ReactNode) => (
    <Shell theme={theme} setTheme={setTheme} nav={nav} user={user} banner={banner}>{children}</Shell>
  )

  if (error && !state) return shell(<p className="w-msg error">{error}</p>)
  if (!demo && (!config || (!state && !signedOut))) return shell(<p className="w-msg">Loading…</p>)
  if (!demo && config && !config.enabled) return shell(<p className="w-msg">The dispatch board is not available right now.</p>)
  if (!demo && config && (signedOut || !state)) return shell(<SignIn config={config} onSignedIn={onSignedIn} onDemo={() => { track('crm_demo'); setDemo(true) }} />)
  if (!state) return shell(<p className="w-msg">Loading…</p>)

  const openLoad = openId == null ? null : state.loads.find((l) => l.id === openId) ?? null

  const TABS: [Tab, string, number][] = [
    ['loads', 'Loads', state.loads.length],
    ['carriers', 'Carriers', state.carriers.length],
    ['dispatchers', 'Dispatchers', state.dispatchers.length],
  ]
  const nav = (
    <nav className="w-tabs">
      {TABS.map(([id, label, n]) => (
        <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}<span>{n}</span></button>
      ))}
    </nav>
  )
  const user = (
    <div className="w-user" title={state.user.email}>
      {state.user.picture ? <img src={state.user.picture} alt="" referrerPolicy="no-referrer" /> : <span className="avatar">{state.user.name.slice(0, 1)}</span>}
      <span>{state.user.name}</span>
      <button className="w-link" onClick={() => (demo ? Promise.resolve(setDemo(false)) : crm.logout().then(() => { setState(null); setSignedOut(true) }))}>{demo ? 'Exit demo' : 'Sign out'}</button>
    </div>
  )

  return shell(
    <>
      {tab === 'loads' && (
        <LoadsTable
          state={state}
          addLoad={addLoad}
          updateLoad={updateLoad}
          openLoad={setOpenId}
          updateMany={(loads, patch) => optimistic(
            patchLoads(new Set(loads.map((l) => l.id)), (l) => ({ ...l, ...patch(l) })),
            () => Promise.all(loads.map((l) => api.updateLoad(l.id, { ...l, ...patch(l) }))),
            `Updated ${loads.length} loads`,
          )}
          removeMany={(ids) => optimistic(
            (s) => ({ ...s, loads: s.loads.filter((l) => !ids.includes(l.id)) }),
            () => Promise.all(ids.map((id) => api.removeLoad(id))),
            `Deleted ${ids.length} loads`,
          )}
          importLoads={(rows) => act(async () => {
            const r = await api.importLoads(rows)
            track('crm_import', { rows: r.imported })
            toast(`Imported ${r.imported} loads`)
          })}
        />
      )}
      {openLoad && (
        <LoadDrawer
          key={openLoad.id}
          load={openLoad}
          state={state}
          save={(l) => { updateLoad(openLoad.id, l).catch(() => undefined) }}
          remove={() => { setOpenId(null); optimistic((s) => ({ ...s, loads: s.loads.filter((x) => x.id !== openLoad.id) }), () => api.removeLoad(openLoad.id), 'Load deleted').catch(() => undefined) }}
          close={closeLoad}
          miles={api.miles}
        />
      )}
      {tab === 'carriers' && (
        <CarriersView
          state={state}
          add={(c) => act(() => api.addCarrier(c), 'Carrier added')}
          update={(c) => optimistic((s) => ({ ...s, carriers: s.carriers.map((x) => (x.id === c.id ? c : x)) }), () => api.updateCarrier(c.id, c))}
          remove={(id) => act(() => api.removeCarrier(id))}
        />
      )}
      {tab === 'dispatchers' && (
        <DispatchersView
          state={state}
          add={(d) => act(() => api.addDispatcher(d), 'Dispatcher added')}
          save={(d) => optimistic((s) => ({ ...s, dispatchers: s.dispatchers.map((x) => (x.id === d.id ? d : x)) }), () => api.updateDispatcher(d))}
          remove={(id) => act(() => api.removeDispatcher(id))}
        />
      )}
    </>,
    nav,
    user,
  )
}
