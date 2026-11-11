import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { CarriersView, DispatchersView } from '../components/crm/PeopleViews'
import { LoadsTable } from '../components/crm/LoadsTable'
import { SignIn } from '../components/crm/SignIn'
import { Icon } from '../components/Icon'
import { track } from '../lib/analytics'
import { crm, CrmError, type CrmConfig, type CrmState, type CrmUser } from '../lib/crm'

type Tab = 'loads' | 'carriers' | 'dispatchers'
type Theme = 'light' | 'dark'

const THEME_KEY = 'leadhaul.work.theme'
const readTheme = (): Theme => {
  try {
    return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

/** Full-screen work layout: its own slim top bar instead of the site header, light theme by default. */
function Shell({ theme, setTheme, children, nav, user }: {
  theme: Theme; setTheme: (t: Theme) => void; children: ReactNode; nav?: ReactNode; user?: ReactNode
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
  const [error, setError] = useState('')
  const [theme, setThemeState] = useState<Theme>(readTheme)
  const setTheme = (t: Theme) => {
    setThemeState(t)
    try { localStorage.setItem(THEME_KEY, t) } catch { /* the choice just isn't remembered */ }
  }

  const reload = useCallback(() => crm.state().then((s) => { setState(s); setSignedOut(false) }, (e: CrmError) => {
    if (e.status === 401) setSignedOut(true)
    else setError(e.message)
  }), [])

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

  const shell = (children: ReactNode, nav?: ReactNode, user?: ReactNode) => (
    <Shell theme={theme} setTheme={setTheme} nav={nav} user={user}>{children}</Shell>
  )

  if (error && !state) return shell(<p className="w-msg error">{error}</p>)
  if (!config || (!state && !signedOut)) return shell(<p className="w-msg">Loading…</p>)
  if (!config.enabled) return shell(<p className="w-msg">The dispatch board is not available right now.</p>)
  if (signedOut || !state) return shell(<SignIn config={config} onSignedIn={onSignedIn} />)

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
      <button className="w-link" onClick={() => crm.logout().then(() => { setState(null); setSignedOut(true) })}>Sign out</button>
    </div>
  )

  return shell(
    <>
      {tab === 'loads' && (
        <LoadsTable
          state={state}
          addLoad={(l) => act(() => crm.addLoad(l))}
          updateLoad={(id, l) => act(() => crm.updateLoad(id, l))}
          updateMany={(loads, patch) => act(() => Promise.all(loads.map((l) => crm.updateLoad(l.id, { ...l, ...patch }))), `Updated ${loads.length} loads`)}
          removeMany={(ids) => act(() => Promise.all(ids.map((id) => crm.removeLoad(id))), `Deleted ${ids.length} loads`)}
          importLoads={(rows) => act(async () => {
            const r = await crm.importLoads(rows)
            track('crm_import', { rows: r.imported })
            toast(`Imported ${r.imported} loads`)
          })}
        />
      )}
      {tab === 'carriers' && (
        <CarriersView state={state} add={(c) => act(() => crm.addCarrier(c), 'Carrier added')} remove={(id) => act(() => crm.removeCarrier(id))} />
      )}
      {tab === 'dispatchers' && (
        <DispatchersView
          state={state}
          add={(d) => act(() => crm.addDispatcher(d), 'Dispatcher added')}
          save={(d) => act(() => crm.updateDispatcher(d), 'Saved')}
          remove={(id) => act(() => crm.removeDispatcher(id))}
        />
      )}
    </>,
    nav,
    user,
  )
}
