import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { CarriersView, DispatchersView, TrucksView } from '../components/crm/PeopleViews'
import { StatementsView } from '../components/crm/StatementsView'
import { LoadDrawer, NewLoadDrawer } from '../components/crm/LoadDrawer'
import { LoadsTable } from '../components/crm/LoadsTable'
import { BoardMap } from '../components/crm/MapView'
import { CompanySetup, SignIn } from '../components/crm/SignIn'
import { Icon, type IconName } from '../components/Icon'
import { BoardSkeleton } from '../components/Skeleton'
import { track } from '../lib/analytics'
import { crm, CrmError, looksLikePlace, type Company, type CrmConfig, type CrmState, type CrmUser, type Load, type LoadInput } from '../lib/crm'
import { crmDemo } from '../lib/crmDemo'
import type { BoardTool } from '../App'

type Tab = 'loads' | 'map' | 'statements' | 'carriers' | 'trucks' | 'dispatchers'
type Theme = 'light' | 'dark'

const THEME_KEY = 'leadhaul.work.theme'
const DEMO_KEY = 'leadhaul.dispatchDemo.on'
/** #/crm?demo=1 opens the demo; #/crm?signup and #/crm?login open the account forms (and leave the demo). */
const hashParams = () => new URLSearchParams(location.hash.split('?')[1] ?? '')
// The demo is only on while the address says so (#/crm?demo=1): "Dispatch TMS" always opens your own account.
// Older versions remembered the demo in the browser; that flag is cleared.
try { localStorage.removeItem(DEMO_KEY) } catch { /* nothing stored */ }
const readTheme = (): Theme => {
  try {
    return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

/** Before sign-in (and while loading): a slim bar with the logo over the page. */
function Shell({ theme, children, banner, bare }: { theme: Theme; children: ReactNode; banner?: ReactNode; bare?: boolean }) {
  // Account pages have their own full-screen layout.
  if (bare) return <div className={`work theme-${theme}`}>{children}</div>
  return (
    <div className={`work theme-${theme}`}>
      <header className="w-top">
        <a href="#/" className="w-brand" title="HaulPanel home">
          <img src="/logo.svg" alt="" width="22" height="22" />
          <b>HaulPanel</b>
        </a>
      </header>
      {banner}
      <div className="w-body">{children}</div>
    </div>
  )
}

type NavItem = [Tab, string, IconName, number]

/**
 * Signed in: the TMS layout — a dark sidebar that stays put (your company on top, the sections, tools, and you
 * at the bottom) and one work area that scrolls with the page, so there is a single scroll, never a box inside a box.
 */
function AppShell({ theme, setTheme, items, tab, setTab, tool, setTool, user, company, demo, onLeave, banner, children }: {
  theme: Theme; setTheme: (t: Theme) => void; items: NavItem[]; tab: Tab; setTab: (t: Tab) => void
  tool: BoardTool | null; setTool: (t: BoardTool | null) => void
  user: CrmUser; company?: Company; demo: boolean; onLeave: () => void; banner?: ReactNode; children: ReactNode
}) {
  const org = company?.name || (demo ? 'Demo Dispatch LLC' : user.name)
  const initials = org.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('')
  return (
    <div className={`work app theme-${theme}`}>
      <aside className="w-side">
        <a href="#/" className="w-side-logo" title="HaulPanel home"><img src="/logo.svg" alt="" width="24" height="24" /><b>HaulPanel</b></a>
        <div className="w-org" title={org}>
          <span className="w-org-mark">{initials || 'H'}</span>
          <span className="w-org-text"><b>{org}</b><small>{company?.mc ? `MC ${company.mc}` : demo ? 'Demo account' : 'Dispatch company'}</small></span>
        </div>
        <nav className="w-nav" aria-label="Sections">
          {items.map(([id, label, icon, n]) => (
            <button key={id} title={label} className={!tool && tab === id ? 'on' : ''} aria-current={!tool && tab === id ? 'page' : undefined}
              onClick={() => { setTool(null); setTab(id); scrollTo(0, 0) }}>
              <Icon name={icon} size={16} /><span>{label}</span>{n > 0 && <em>{n}</em>}
            </button>
          ))}
          <div className="w-nav-label">Tools</div>
          <button title="Company lookup" className={tool === 'lookup' ? 'on' : ''} onClick={() => { setTool('lookup'); scrollTo(0, 0) }}>
            <Icon name="search" size={16} /><span>Company lookup</span>
          </button>
          <button title="New MC leads" className={tool === 'leads' ? 'on' : ''} onClick={() => { setTool('leads'); scrollTo(0, 0) }}>
            <Icon name="zap" size={16} /><span>New MC leads</span>
          </button>
        </nav>
        <div className="w-side-foot">
          <button className="w-nav-btn" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
            <Icon name={theme === 'light' ? 'moon' : 'sun'} size={16} /><span>{theme === 'light' ? 'Dark theme' : 'Light theme'}</span>
          </button>
          <div className="w-me" title={user.email}>
            {user.picture ? <img src={user.picture} alt="" referrerPolicy="no-referrer" /> : <span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span>}
            <span className="w-me-text"><b>{user.name}</b><small>{demo ? 'Trying the demo' : user.email}</small></span>
            <button className="w-me-out" title={demo ? 'Exit demo' : 'Sign out'} aria-label={demo ? 'Exit demo' : 'Sign out'} onClick={onLeave}>
              <Icon name="logout" size={16} />
            </button>
          </div>
        </div>
      </aside>
      <main className="w-main">
        {banner}
        <div className="w-body">{children}</div>
      </main>
    </div>
  )
}

/** Dispatch board (TMS): sign in with Google, then the load journal, carriers and dispatchers. */
export function CrmPage({ toast, tool, setTool, toolSlot }: {
  toast: (m: string) => void
  /** Lookup or New MC leads opened from the sidebar; they are placed into `toolSlot`. */
  tool: BoardTool | null
  setTool: (t: BoardTool | null) => void
  toolSlot: (el: HTMLElement | null) => void
}) {
  const [config, setConfig] = useState<CrmConfig | null>(null)
  const [state, setState] = useState<CrmState | null>(null)
  const [signedOut, setSignedOut] = useState(false)
  const [tab, setTab] = useState<Tab>('loads')
  /** Load open in the side panel. */
  const [openId, setOpenId] = useState<number | null>(null)
  /** New-load form open, with the carrier/dispatcher it starts from. */
  const [creating, setCreating] = useState<{ carrierId: string; dispatcherId: string } | null>(null)
  const [error, setError] = useState('')
  const [theme, setThemeState] = useState<Theme>(readTheme)
  const [demo, setDemoState] = useState(() => hashParams().has('demo'))
  const api = demo ? crmDemo : crm
  const setDemo = (on: boolean) => {
    history.replaceState(null, '', on ? '#/crm?demo=1' : '#/crm')
    setDemoState(on)
    setState(null)
  }
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
    toast(`Welcome, ${u.name.split(' ')[0] || u.email} — you’re signed in`)
    void reload()
  }, [reload, toast])

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
  const closeNew = useCallback(() => setCreating(null), [])
  const newLoad = useCallback((d: { carrierId: string; dispatcherId: string }) => setCreating(d), [])

  // Loaded miles fill themselves in: every load with a lane and no miles is looked up on the map in the background,
  // one at a time (each lane once; the server remembers lanes, so repeats are instant).
  const latest = useRef(state)
  latest.current = state
  const triedMiles = useRef(new Set<string>())
  useEffect(() => {
    const todo = (state?.loads ?? []).filter((l) => l.id > 0 && looksLikePlace(l.origin) && looksLikePlace(l.destination) && !l.loadedMiles
      && !triedMiles.current.has(`${l.id}|${l.origin}|${l.destination}`))
    if (!todo.length) return
    let cancelled = false
    void (async () => {
      for (const l of todo.slice(0, 30)) {
        if (cancelled) return
        const key = `${l.id}|${l.origin}|${l.destination}`
        if (triedMiles.current.has(key)) continue
        triedMiles.current.add(key)
        try {
          const r = await api.miles(l.origin, l.destination)
          const cur = latest.current?.loads.find((x) => x.id === l.id)
          if (!r.miles || !cur || cur.loadedMiles || cur.origin !== l.origin || cur.destination !== l.destination) continue
          const { id, ...rest } = cur
          await updateLoad(id, { ...rest, loadedMiles: r.miles }).catch(() => undefined)
        } catch {
          // Place not on the map or maps busy: the load panel's Calculate button is still there.
        }
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.loads, demo])

  const banner = demo && state ? (
    <div className="w-demo">
      <b>Demo</b> Sample data, saved only in this browser. Try anything — add loads, change statuses, import your sheet.
      <button className="w-link" onClick={() => { crmDemo.reset(); void reload() }}>Reset demo</button>
      <button className="primary" onClick={() => setDemo(false)}>Sign in to use it for real</button>
    </div>
  ) : null
  const shell = (children: ReactNode, bare = false) => <Shell theme={theme} banner={banner} bare={bare}>{children}</Shell>

  if (error && !state) return shell(<p className="w-msg error">{error}</p>)
  if (!demo && (!config || (!state && !signedOut))) return <BoardSkeleton theme={theme} />
  if (!demo && config && !config.enabled) return shell(<p className="w-msg">The dispatch board is not available right now.</p>)
  if (!demo && config && (signedOut || !state)) return shell(<SignIn config={config} initial={hashParams().has('login') ? 'login' : 'signup'} onSignedIn={onSignedIn} onDemo={() => { track('crm_demo'); setDemo(true) }} />, true)
  if (!state) return <BoardSkeleton theme={theme} />

  // A Google sign-up hasn't told us about the company yet: ask first, like other TMSs do.
  if (!demo && state.company && !state.company.name) {
    return shell(<CompanySetup user={state.user} onDone={() => { track('crm_company'); void reload() }} />, true)
  }

  const openLoad = openId == null ? null : state.loads.find((l) => l.id === openId) ?? null

  const items: NavItem[] = [
    ['loads', 'Loads', 'file', state.loads.length],
    ['map', 'Map', 'map', state.loads.filter((l) => l.status === 'in_transit').length],
    ['statements', 'Statements', 'dollar', state.carriers.filter((c) => c.fee > 0).length],
    ['carriers', 'Carriers', 'building', state.carriers.length],
    ['trucks', 'Trucks', 'truck', state.trucks.length],
    ['dispatchers', 'Dispatchers', 'users', state.dispatchers.length],
  ]
  const leave = () => (demo ? setDemo(false) : void crm.logout().then(() => { setState(null); setSignedOut(true) }))

  return (
    <AppShell theme={theme} setTheme={setTheme} items={items} tab={tab} setTab={setTab} tool={tool} setTool={setTool} user={state.user} company={state.company}
      demo={demo} onLeave={leave} banner={banner}>
      {tool && <div className={`w-tool w-tool-${tool}`} ref={toolSlot} />}
      {!tool && tab === 'loads' && (
        <LoadsTable
          state={state}
          updateLoad={updateLoad}
          openLoad={setOpenId}
          newLoad={newLoad}
          goTab={setTab}
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
          lane={api.lane}
          theme={theme}
          saveCarrier={(c) => { optimistic((s) => ({ ...s, carriers: s.carriers.map((x) => (x.id === c.id ? c : x)) }), () => api.updateCarrier(c.id, c), `${c.name}’s fee saved`).catch(() => undefined) }}
        />
      )}
      {creating && (
        <NewLoadDrawer state={state} defaults={creating} close={closeNew} miles={api.miles}
          add={(l) => addLoad(l).then(() => track('crm_add_load'))} />
      )}
      {!tool && tab === 'carriers' && (
        <CarriersView
          state={state}
          add={(c) => act(() => api.addCarrier(c), 'Carrier added')}
          update={(c) => optimistic((s) => ({ ...s, carriers: s.carriers.map((x) => (x.id === c.id ? c : x)) }), () => api.updateCarrier(c.id, c))}
          remove={(id) => act(() => api.removeCarrier(id))}
        />
      )}
      {!tool && tab === 'map' && <BoardMap state={state} theme={theme} openLoad={setOpenId} points={api.points} />}
      {!tool && tab === 'statements' && <StatementsView state={state} toast={toast} />}
      {!tool && tab === 'trucks' && (
        <TrucksView
          state={state}
          add={(t) => act(() => api.addTruck(t), 'Truck added')}
          update={(t) => optimistic((s) => ({ ...s, trucks: s.trucks.map((x) => (x.id === t.id ? t : x)) }), () => api.updateTruck(t.id, t))}
          remove={(id) => act(() => api.removeTruck(id))}
        />
      )}
      {!tool && tab === 'dispatchers' && (
        <DispatchersView
          state={state}
          add={(d) => act(() => api.addDispatcher(d), 'Dispatcher added')}
          save={(d) => optimistic((s) => ({ ...s, dispatchers: s.dispatchers.map((x) => (x.id === d.id ? d : x)) }), () => api.updateDispatcher(d))}
          remove={(id) => act(() => api.removeDispatcher(id))}
        />
      )}
    </AppShell>
  )
}
