import { useCallback, useEffect, useState } from 'react'
import { track } from '../../lib/analytics'
import { crm, dutyLabel, hoursLeft, type CrmState, type EldProvider, type EldUnit, type Integrations } from '../../lib/crm'
import { APPS, appById, CATEGORIES, LOGOS, ON_ZAPIER, type App, type Category } from '../../lib/integrationsCatalog'
import { Icon, type IconName } from '../Icon'

// Integrations, laid out like an app marketplace: what's connected on top, then every company HaulPanel can connect
// with, grouped by category, each with its logo and an honest status. A card opens its panel: what it does, what it
// may access, the ways to connect (direct API, the company's own MCP server for the AI assistant, connect hubs that
// reach it) and setup or the live connection. "I use it" on a not-yet-built one tells us what to build first.

const ago = (iso: string | null) => {
  if (!iso) return ''
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`
}

const CAT_ICON: Record<Category, IconName> = {
  hubs: 'plug', eld: 'truck', loadboards: 'database', brokers: 'building', factoring: 'dollar', fuel: 'zap', tolls: 'map', accounting: 'chart',
  payments: 'dollar', vetting: 'shield', insurance: 'lifebuoy', rates: 'chart', comms: 'mail', docs: 'file', drivers: 'phone', automation: 'refresh',
}
type Tab = 'all' | 'mcp' | Category
type Status = { label: string; tone: 'ok' | 'bad' | 'muted' | 'built' | 'review' }

/** Not-yet-built integrations this person said they use (kept in the browser). */
const WANTED_KEY = 'hp.integrations.wanted'
const readWanted = (): Set<string> => { try { return new Set(JSON.parse(localStorage.getItem(WANTED_KEY) ?? '[]') as string[]) } catch { return new Set() } }

const ELD: Record<EldProvider, { name: string; what: string; field: string; steps: string[] }> = {
  samsara: {
    name: 'Samsara', what: 'Trucks on your map, live tracking for brokers, drivers’ hours of service', field: 'Samsara API token',
    steps: [
      'In Samsara open Settings → API Tokens → Add an API Token.',
      'Name it “HaulPanel”. Give it Read access only: Vehicles, Vehicle Statistics, Drivers and ELD Compliance (for hours of service).',
      'Copy the token (Samsara shows it once) and paste it here.',
    ],
  },
  motive: {
    name: 'Motive (KeepTruckin)', what: 'Trucks on your map, live tracking for brokers, drivers’ hours of service', field: 'Motive API key',
    steps: [
      'In Motive open Admin → Developers → API Access → Create API Key.',
      'Give it read scopes only: Vehicles, Locations, Users and HOS (available time).',
      'Copy the key and paste it here.',
    ],
  },
}


const mcpConn = (app: App, data: Integrations) => data.connections.find((c) => c.provider === `mcp:${app.id}`)
const mcpReady = (app: App, data: Integrations) => !!data.mcp?.includes(app.id)
/** Reachable through the owner's own Zapier (when Zapier can be connected here). */
const viaZapier = (app: App, data: Integrations) => ON_ZAPIER.has(app.id) && !!data.mcp?.includes('zapier')
const zapierOn = (data: Integrations) => data.connections.some((c) => c.provider === 'mcp:zapier' && c.status === 'ok')

function statusOf(app: App, data: Integrations, state: CrmState): Status {
  const mc = mcpConn(app, data)
  const direct = directStatus(app, data, state)
  if (mc && direct.tone !== 'ok') return mc.status === 'ok' ? { label: 'Connected', tone: 'ok' } : { label: 'Needs attention', tone: 'bad' }
  if (mcpReady(app, data) && !['ok', 'bad', 'built'].includes(direct.tone) && direct.label !== 'Available') return { label: 'Available', tone: 'muted' }
  if (viaZapier(app, data) && !['ok', 'bad', 'built'].includes(direct.tone) && direct.label !== 'Available') return zapierOn(data) ? { label: 'Via Zapier', tone: 'built' } : { label: 'Via Zapier', tone: 'muted' }
  return direct
}

function directStatus(app: App, data: Integrations, state: CrmState): Status {
  if (app.kind === 'eld') {
    const conn = data.connections.find((c) => c.provider === app.provider)
    if (conn) return conn.status === 'ok' ? { label: 'Connected', tone: 'ok' } : { label: 'Needs attention', tone: 'bad' }
    return data.providers.includes(app.provider!) ? { label: 'Available', tone: 'muted' } : { label: 'Partner review', tone: 'review' }
  }
  if (app.kind === 'quickbooks') {
    const conn = data.connections.find((c) => c.provider === 'quickbooks')
    if (conn) return conn.status === 'ok' ? { label: 'Connected', tone: 'ok' } : { label: 'Needs attention', tone: 'bad' }
    return data.quickbooks ? { label: 'Available', tone: 'muted' } : { label: 'Coming soon', tone: 'muted' }
  }
  if (app.kind === 'factoring' || app.kind === 'fmcsa') return { label: 'Built in', tone: 'built' }
  if (app.kind === 'telegram') return (state.drivers?.length ?? 0) > 0 ? { label: `${state.drivers!.length} ${state.drivers!.length === 1 ? 'driver' : 'drivers'}`, tone: 'ok' } : { label: 'Built in', tone: 'built' }
  return app.kind === 'requested' ? { label: 'Access requested', tone: 'review' } : { label: 'Planned', tone: 'muted' }
}
const isLive = (app: App, data: Integrations) => mcpReady(app, data) || viaZapier(app, data) || directLive(app, data)
/** Works without MCP: built in, or the direct connection is switched on. */
const directLive = (app: App, data: Integrations) =>
  app.kind === 'factoring' || app.kind === 'telegram' || app.kind === 'fmcsa' || (app.kind === 'eld' && data.providers.includes(app.provider!)) || (app.kind === 'quickbooks' && data.quickbooks)
const rank = (app: App, data: Integrations, state: CrmState) => {
  const t = statusOf(app, data, state).tone
  return t === 'ok' || t === 'bad' ? 0 : isLive(app, data) ? 1 : t === 'review' ? 2 : 3
}

/** The company's logo (or its initials on its color when we have none). */
const Tile = ({ app, big }: { app: App; big?: boolean }) => LOGOS.has(app.id)
  ? <span className={`ig-tile logo ${big ? 'big' : ''}`} aria-hidden="true"><img src={`/logos/${app.id}.png`} alt="" loading="lazy" /></span>
  : <span className={`ig-tile ${big ? 'big' : ''}`} style={{ background: app.tint }} aria-hidden="true">{app.tile}</span>

export function IntegrationsView({ state, owner, changed, toast, openTab, initialApp }: {
  state: CrmState; owner: boolean; changed: () => void; toast: (m: string) => void
  /** Opens another section of the board (Trucks, Loads, the fleet map, the AI assistant). */
  openTab?: (tab: 'trucks' | 'loads' | 'map' | 'ai') => void
  /** Open this company's panel first (back from connecting it). */
  initialApp?: string | null
}) {
  const [data, setData] = useState<Integrations | null>(null)
  const [err, setErr] = useState('')
  const [tab, setTab] = useState<Tab>('all')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(initialApp ?? null)
  useEffect(() => { if (initialApp) setOpen(initialApp) }, [initialApp])
  const [wanted, setWanted] = useState(readWanted)
  const load = useCallback(() => crm.integrations().then(setData, (e: Error) => setErr(e.message)), [])
  useEffect(() => { void load() }, [load])
  const refresh = () => { void load(); changed() }
  const want = (app: App) => {
    track('integration_interest', { app: app.id })
    const next = new Set(wanted).add(app.id)
    setWanted(next)
    try { localStorage.setItem(WANTED_KEY, JSON.stringify([...next])) } catch { /* private mode */ }
    toast(`Noted — ${app.name} moves up our list`)
  }

  if (err) return <p className="w-msg error">{err}</p>
  if (!data) return <IntegrationsSkeleton />

  const connected = APPS.filter((a) => (a.kind === 'eld' || a.kind === 'quickbooks' || !!mcpConn(a, data)) && ['ok', 'bad'].includes(statusOf(a, data, state).tone))
  const needle = q.trim().toLowerCase()
  const match = (a: App) => !needle || `${a.name} ${a.maker} ${a.blurb} ${a.reaches ?? ''}`.toLowerCase().includes(needle)
  const inTab = (a: App, t: Tab) => t === 'all' || (t === 'mcp' ? !!a.mcp : a.category === t)
  const sorted = (list: App[]) => [...list].sort((a, b) => rank(a, data, state) - rank(b, data, state) || a.name.localeCompare(b.name))
  const tabs: [Tab, string, IconName][] = [['all', 'All', 'spark'], ['mcp', 'AI · MCP', 'bot'], ...CATEGORIES.map(([c, l]) => [c, l, CAT_ICON[c]] as [Tab, string, IconName])]
  const counts = new Map(tabs.map(([t]) => [t, APPS.filter((a) => inTab(a, t)).length]))
  const grouped = tab === 'all' && !needle
  const live = APPS.filter((a) => isLive(a, data)).length
  const app = open ? appById(open) : undefined
  const card = (a: App) => <AppCard key={a.id} app={a} st={statusOf(a, data, state)} live={isLive(a, data)} wanted={wanted.has(a.id)} onOpen={() => setOpen(a.id)} />

  return (
    <div className="ig">
      <header className="ig-head">
        <div>
          <h1>Integrations</h1>
          <p>{APPS.length} companies HaulPanel connects with · {live} work today · read-only where it matters.</p>
        </div>
        <label className="ig-search"><Icon name="search" size={16} /><input type="search" placeholder="Search companies" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search integrations" /></label>
      </header>
      {!data.ready && <p className="ig-note">Integrations are being switched on for your account — check back shortly.</p>}

      {connected.length > 0 && !needle && (
        <section className="ig-sec">
          <h2>Connected</h2>
          <div className="ig-conn">
            {connected.map((a) => {
              const st = statusOf(a, data, state)
              const conn = data.connections.find((c) => c.provider === (a.provider ?? a.id))
              const units = a.provider ? data.units.filter((u) => u.provider === a.provider) : []
              return (
                <button key={a.id} className="ig-conn-row" onClick={() => setOpen(a.id)}>
                  <Tile app={a} />
                  <span className="ig-conn-main"><b>{a.name}</b>
                    <small>{mcpConn(a, data) && !conn ? `AI assistant connected · since ${ago(mcpConn(a, data)!.connectedAt)}` : a.kind === 'eld' ? `${units.length} ${units.length === 1 ? 'vehicle' : 'vehicles'} · ${units.filter((u) => u.truckId).length} matched` : `${conn?.invoices ?? 0} invoices`}{conn?.syncedAt ? ` · synced ${ago(conn.syncedAt)}` : ''}</small>
                  </span>
                  <em className={`ig-pill ${st.tone}`}><i />{st.label}</em>
                  <span className="ig-manage">Manage →</span>
                </button>
              )
            })}
          </div>
        </section>
      )}

      <div className="ig-tabs" role="tablist" aria-label="Categories">
        {tabs.filter(([t]) => (counts.get(t) ?? 0) > 0).map(([t, label, icon]) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            <Icon name={icon} size={15} />{label}<em>{counts.get(t)}</em>
          </button>
        ))}
      </div>

      {tab === 'mcp' && !needle && (
        <p className="ig-intro"><Icon name="bot" size={16} /><span>These companies run their own <b>MCP server</b> — the standard way for an AI assistant to work inside an account you sign in to. Through it HaulPanel’s AI will read (and where allowed, act in) your account: “where is truck 101”, “send the invoice to QuickBooks”.</span></p>
      )}
      {tab === 'hubs' && !needle && (
        <p className="ig-intro"><Icon name="plug" size={16} /><span>A <b>connect hub</b> is one integration that reaches many companies at once — hundreds of ELD brands through Terminal, every accounting system through Merge, thousands of apps through Zapier or Pipedream.</span></p>
      )}

      {grouped ? CATEGORIES.map(([c, label]) => {
        const list = sorted(APPS.filter((a) => a.category === c))
        if (!list.length) return null
        return (
          <section key={c} className="ig-sec">
            <h2 className="ig-cat"><Icon name={CAT_ICON[c]} size={15} />{label}<em>{list.length}</em></h2>
            <div className="ig-cards">{list.map(card)}</div>
          </section>
        )
      }) : (
        <section className="ig-sec">
          <div className="ig-cards">{sorted(APPS.filter((a) => inTab(a, tab) && match(a))).map(card)}</div>
          {!APPS.some((a) => inTab(a, tab) && match(a)) && <p className="ig-muted">Nothing matches “{q}”.</p>}
        </section>
      )}
      <p className="ig-muted ig-foot">Missing a company? Until a connection is ready, an export file from it works in <b>Home → Import your data</b>. Tell us what you use — reply to any HaulPanel email.</p>

      {app && <AppPanel app={app} data={data} state={state} owner={owner} refresh={refresh} toast={toast} openTab={openTab}
        wanted={wanted.has(app.id)} want={() => want(app)} openApp={setOpen} close={() => setOpen(null)} />}
    </div>
  )
}

function AppCard({ app, st, live, wanted, onOpen }: { app: App; st: Status; live: boolean; wanted: boolean; onOpen: () => void }) {
  const cta = st.tone === 'ok' || st.tone === 'bad' ? 'Manage' : live ? (app.kind === 'eld' || app.kind === 'quickbooks' || app.mcp || ON_ZAPIER.has(app.id) ? 'Connect' : 'Set up') : 'Details'
  return (
    <button className={`ig-app ${live ? '' : 'soon'}`} onClick={onOpen}>
      <span className="ig-app-top">
        <Tile app={app} />
        <span><b>{app.name}</b><small>{app.maker}</small></span>
      </span>
      <span className="ig-app-blurb">{app.blurb}</span>
      <span className="ig-app-tags">
        {app.reaches && <em className="ig-tag hub"><Icon name="plug" size={12} />{app.reaches}</em>}
        {app.mcp && <em className="ig-tag mcp"><Icon name="bot" size={12} />MCP</em>}
        {ON_ZAPIER.has(app.id) && <em className="ig-tag zap"><Icon name="zap" size={12} />Zapier</em>}
        {app.via?.length ? <em className="ig-tag">+{app.via.length} hubs</em> : null}
        {wanted && <em className="ig-tag want"><Icon name="check" size={12} />You use it</em>}
      </span>
      <span className="ig-app-foot">
        <em className={`ig-pill ${st.tone}`}><i />{st.label}</em>
        <span className="ig-app-cta">{cta} →</span>
      </span>
    </button>
  )
}

/** The side panel of one company: about, the ways to connect, then setup or the live connection, and access. */
function AppPanel({ app, data, state, owner, refresh, toast, openTab, wanted, want, openApp, close }: {
  app: App; data: Integrations; state: CrmState; owner: boolean; refresh: () => void; toast: (m: string) => void
  openTab?: (tab: 'trucks' | 'loads' | 'map' | 'ai') => void; wanted: boolean; want: () => void; openApp: (id: string) => void; close: () => void
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    addEventListener('keydown', esc)
    return () => removeEventListener('keydown', esc)
  }, [close])
  const st = statusOf(app, data, state)
  const live = isLive(app, data)
  const hubs = (app.via ?? []).map(appById).filter(Boolean) as App[]
  const reached = app.category === 'hubs' ? APPS.filter((a) => a.via?.includes(app.id)) : []
  const dLive = directLive(app, data)
  const dSt = directStatus(app, data, state)
  const direct = dLive ? (dSt.tone === 'ok' ? 'Connected' : dSt.tone === 'bad' ? 'Needs attention' : 'Works now') : app.kind === 'requested' || app.kind === 'eld' ? 'Access requested' : 'Planned'
  const directTone = dLive ? (dSt.tone === 'muted' ? 'built' : dSt.tone) : app.kind === 'requested' || app.kind === 'eld' ? 'review' : 'muted'
  return (
    <div className="ld-backdrop" onClick={close}>
      <aside className="ld ig-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={app.name}>
        <header className="ig-panel-head">
          <Tile app={app} big />
          <div className="ig-panel-title"><small>{app.maker}{app.domain ? ` · ${app.domain}` : ''}</small><h2>{app.name}</h2><em className={`ig-pill ${st.tone}`}><i />{st.label}</em></div>
          <button className="ld-x" onClick={close} aria-label="Close">×</button>
        </header>
        <div className="ig-panel-body">
          <p className="ig-lead">{app.blurb}</p>

          {app.kind === 'eld' && directLive(app, data) && <EldSetup provider={app.provider!} data={data} state={state} owner={owner} refresh={refresh} toast={toast} openMap={openTab ? () => openTab('map') : undefined} />}
          {app.kind === 'quickbooks' && directLive(app, data) && <QuickBooksSetup data={data} owner={owner} refresh={refresh} toast={toast} />}
          {app.kind === 'factoring' && <FactoringInfo state={state} openLoads={openTab ? () => { close(); openTab('loads') } : undefined} />}
          {app.kind === 'telegram' && (
            <div className="ig-box">
              <b>Set up</b>
              <p className="ig-muted">Open <b>Trucks</b>, press <b>+ Connect driver’s Telegram</b> on a truck and send the driver the link. They tap it once in Telegram — that’s all.</p>
              {openTab && <div className="ig-actions"><button className="primary" onClick={() => { close(); openTab('trucks') }}>Go to Trucks</button></div>}
            </div>
          )}
          {app.kind === 'fmcsa' && <div className="ig-box"><b>Always on</b><p className="ig-muted">Type an MC on a load or a carrier and the check runs by itself. New MCs every day are in <b>New MC leads</b>.</p></div>}
          {mcpReady(app, data) && <McpConnect app={app} data={data} owner={owner} refresh={refresh} toast={toast} askAi={openTab ? () => { close(); openTab('ai') } : undefined} />}
          {viaZapier(app, data) && app.id !== 'zapier' && !mcpConn(app, data) && <ZapierRoute app={app} data={data} owner={owner} toast={toast} openZapier={() => openApp('zapier')} askAi={openTab ? () => { close(); openTab('ai') } : undefined} />}
          {!live && app.pending && (
            <div className="ig-box ig-wait">
              <b>Not available yet</b>
              <p className="ig-muted">{app.pending}</p>
              <div className="ig-actions">
                <button className={wanted ? '' : 'primary'} disabled={wanted} onClick={want}>{wanted ? '✓ Noted — you use it' : `I use ${app.name}`}</button>
              </div>
            </div>
          )}

          <section className="ig-sub">
            <h3>Ways to connect</h3>
            <ul className="ig-ways">
              {app.category !== 'hubs' && <li><Icon name="plug" size={16} /><span><b>Direct connection</b><small>{app.kind === 'eld' ? 'API token from your account' : app.kind === 'quickbooks' ? 'Sign in with Intuit' : dLive ? 'Built into HaulPanel' : 'Their API, with your permission'}</small></span><em className={`ig-pill ${directTone}`}><i />{direct}</em></li>}
              {app.category === 'hubs' && <li><Icon name="plug" size={16} /><span><b>One connection</b><small>Reaches: {app.reaches}</small></span><em className={`ig-pill ${st.tone}`}><i />{st.label}</em></li>}
              {app.mcp && <li><Icon name="bot" size={16} /><span><b>AI assistant · MCP</b><small>{app.name}’s own MCP server{app.mcp.includes('.') ? ` (${app.mcp})` : ''} — HaulPanel’s AI works in your account after you sign in</small></span>{mcpConn(app, data) ? <em className="ig-pill ok"><i />Connected</em> : mcpReady(app, data) ? <em className="ig-pill built"><i />Ready to connect</em> : <em className="ig-pill muted"><i />Planned</em>}</li>}
              {ON_ZAPIER.has(app.id) && app.id !== 'zapier' && <li><Icon name="zap" size={16} /><span><b>Through your Zapier</b><small>Connect Zapier once, turn on {app.name} actions there — the AI uses them</small></span>{zapierOn(data) ? <em className="ig-pill ok"><i />Zapier connected</em> : data.mcp?.includes('zapier') ? <em className="ig-pill built"><i />Ready to connect</em> : <em className="ig-pill muted"><i />Planned</em>}</li>}
              {hubs.length > 0 && (
                <li><Icon name="refresh" size={16} /><span><b>Through a connect hub</b>
                  <small className="ig-hubs">{hubs.map((h) => <button key={h.id} className="ig-chip" onClick={() => openApp(h.id)}><Tile app={h} />{h.name}</button>)}</small></span>
                  <em className="ig-pill muted"><i />Planned</em></li>
              )}
            </ul>
          </section>

          {reached.length > 0 && (
            <section className="ig-sub">
              <h3>Reaches in this catalog</h3>
              <div className="ig-hubs">{reached.map((r) => <button key={r.id} className="ig-chip" onClick={() => openApp(r.id)}><Tile app={r} />{r.name}</button>)}</div>
            </section>
          )}

          <section className="ig-sub">
            <h3>What it does</h3>
            <ul className="ig-checks">{app.does.map((d) => <li key={d}>{d}</li>)}</ul>
          </section>
          <section className="ig-sub">
            <h3>Access</h3>
            <ul className="ig-perms">{app.reads.map((d) => <li key={d}>{d}</li>)}</ul>
            {app.kind === 'eld' && <p className="ig-muted">Read-only. The token is stored encrypted and can be removed any time with Disconnect.</p>}
          </section>
        </div>
      </aside>
    </div>
  )
}

/** A company reached through the owner's own Zapier: connect Zapier, turn the company's actions on there, ask the AI. */
function ZapierRoute({ app, data, owner, toast, openZapier, askAi }: {
  app: App; data: Integrations; owner: boolean; toast: (m: string) => void; openZapier: () => void; askAi?: () => void
}) {
  const on = zapierOn(data)
  const [busy, setBusy] = useState(false)
  const connect = async () => {
    setBusy(true)
    try { location.href = (await crm.mcpConnect('zapier')).url } catch (e) { toast((e as Error).message); setBusy(false) }
  }
  return (
    <div className="ig-box">
      <b>Connect {app.name} through Zapier</b>
      <ol className="ig-steps">
        <li className={on ? 'done' : ''}>
          <span>{on ? <>Zapier is connected ✓ <button className="w-link" onClick={openZapier}>manage</button></> : 'Connect your Zapier account (free plan works to start).'}</span>
          {!on && <button className="primary" disabled={busy || !owner || !data.ready} onClick={() => void connect()}>{busy ? 'Opening…' : 'Connect Zapier'}</button>}
        </li>
        <li>
          <span>In Zapier MCP, add {app.name} and turn on the actions the AI may use (for example: find, create, send).</span>
          <a className="btn" href="https://mcp.zapier.com/" target="_blank" rel="noopener">Open Zapier MCP ↗</a>
        </li>
        <li>
          <span>Ask the assistant — it uses {app.name} through Zapier and shows each step.</span>
          {askAi && <button onClick={askAi} disabled={!on}>Ask the AI</button>}
        </li>
      </ol>
      {!owner && <small className="ig-muted">Only the owner of the board can connect it.</small>}
      <small className="ig-muted">Each action the AI runs counts as a Zapier task on your plan.</small>
    </div>
  )
}

/** Connecting a service's own MCP server for the AI assistant: sign in there, then the AI can use its tools. */
function McpConnect({ app, data, owner, refresh, toast, askAi }: {
  app: App; data: Integrations; owner: boolean; refresh: () => void; toast: (m: string) => void; askAi?: () => void
}) {
  const conn = mcpConn(app, data)
  const [busy, setBusy] = useState(false)
  const [tools, setTools] = useState<{ name: string; description: string }[] | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    if (!conn) return
    let live = true
    crm.mcpTools(app.id).then((r) => { if (live) setTools(r.tools) }, (e: Error) => { if (live) setErr(e.message) })
    return () => { live = false }
  }, [app.id, conn?.connectedAt]) // eslint-disable-line react-hooks/exhaustive-deps
  const connect = async () => {
    setBusy(true)
    try { location.href = (await crm.mcpConnect(app.id)).url } catch (e) { toast((e as Error).message); setBusy(false) }
  }
  const disconnect = async () => {
    if (!confirm(`Disconnect ${app.name}? The AI assistant stops using it.`)) return
    setBusy(true)
    try { await crm.disconnect(`mcp:${app.id}`); refresh() } catch (e) { toast((e as Error).message) } finally { setBusy(false) }
  }
  if (!conn) return (
    <div className="ig-box">
      <b>Connect {app.name} to the AI assistant</b>
      <p className="ig-muted">You sign in on {app.name}’s own page and choose what to allow. Then ask the assistant about your {app.name} account in plain words. You can disconnect any time.</p>
      <div className="ig-actions">
        <button className="primary" disabled={busy || !owner || !data.ready} onClick={() => void connect()}>{busy ? 'Opening…' : `Connect ${app.name}`}</button>
      </div>
      {!owner && <small className="ig-muted">Only the owner of the board can connect it.</small>}
    </div>
  )
  return (
    <div className="ig-box">
      <div className="ig-stats">
        <span><em>AI assistant</em><b>{conn.status === 'ok' ? 'Connected' : 'Needs attention'}</b></span>
        <span><em>Tools</em><b>{tools ? tools.length : err ? '—' : '…'}</b></span>
        <span><em>Since</em><b>{ago(conn.connectedAt)}</b></span>
      </div>
      {(conn.status === 'error' || err) && <p className="ig-error">{conn.error || err}</p>}
      <div className="ig-actions">
        {askAi && <button className="primary" onClick={askAi}>Ask the AI</button>}
        {(conn.status === 'error' || err) && owner && <button onClick={() => void connect()} disabled={busy}>Connect again</button>}
        {owner && <button className="ghost danger" disabled={busy} onClick={() => void disconnect()}>Disconnect</button>}
      </div>
      {tools && tools.length > 0 && (
        <details className="ig-tools">
          <summary>What the AI can do in {app.name} ({tools.length})</summary>
          <ul>{tools.slice(0, 80).map((t) => <li key={t.name}><code>{t.name}</code>{t.description ? ` — ${t.description}` : ''}</li>)}</ul>
        </details>
      )}
    </div>
  )
}

/** The page's shape while it loads. */
function IntegrationsSkeleton() {
  return (
    <div className="ig" aria-busy="true" aria-label="Loading integrations">
      <header className="ig-head">
        <div><span className="sk" style={{ width: 180, height: 26 }} /><span className="sk" style={{ width: 420, height: 14, marginTop: 10 }} /></div>
        <span className="sk" style={{ width: 280, height: 38, borderRadius: 9 }} />
      </header>
      <div className="ig-tabs">{[70, 90, 110, 100, 90, 120].map((w, i) => <span key={i} className="sk" style={{ width: w, height: 16, margin: '10px 8px' }} />)}</div>
      <section className="ig-sec">
        <span className="sk" style={{ width: 120, height: 13 }} />
        <div className="ig-cards">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="ig-app sk-card">
              <span className="ig-app-top"><span className="sk" style={{ width: 40, height: 40, borderRadius: 10 }} /><span><span className="sk" style={{ width: 120, height: 15 }} /><span className="sk" style={{ width: 90, height: 11, marginTop: 6 }} /></span></span>
              <span><span className="sk" style={{ width: '100%', height: 12 }} /><span className="sk" style={{ width: '80%', height: 12, marginTop: 7 }} /></span>
              <span className="ig-app-foot"><span className="sk" style={{ width: 90, height: 22, borderRadius: 99 }} /><span className="sk" style={{ width: 60, height: 13 }} /></span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function EldSetup({ provider, data, state, owner, refresh, toast, openMap }: {
  provider: EldProvider; data: Integrations; state: CrmState; owner: boolean; refresh: () => void; toast: (m: string) => void; openMap?: () => void
}) {
  const info = ELD[provider]
  const conn = data.connections.find((c) => c.provider === provider)
  const units = data.units.filter((u) => u.provider === provider)
  const [open, setOpen] = useState(!conn)
  const [token, setToken] = useState('')
  const [region, setRegion] = useState('us')
  const [busy, setBusy] = useState('')
  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label)
    try { await fn() } catch (e) { toast((e as Error).message) } finally { setBusy('') }
  }
  const connect = () => run('Checking the token…', async () => {
    const r = await crm.connectEld(provider, token.trim(), region)
    setToken(''); setOpen(false)
    toast(`${info.name} connected: ${r.vehicles} ${r.vehicles === 1 ? 'vehicle' : 'vehicles'}${r.linked ? `, ${r.linked} matched to your trucks` : ''}`)
    refresh()
  })
  const sync = () => run('Syncing…', async () => { const r = await crm.syncEld(provider); toast(`Updated ${r.vehicles} vehicles`); refresh() })
  const disconnect = () => { if (confirm(`Disconnect ${info.name}? Its trucks stop updating on your map.`)) void run('…', async () => { await crm.disconnect(provider); refresh() }) }

  return (
    <>
      {conn && (
        <div className="ig-box">
          <div className="ig-stats">
            <span><em>Vehicles</em><b>{units.length}</b></span>
            <span><em>Matched to trucks</em><b>{units.filter((u) => u.truckId).length}</b></span>
            <span><em>Last sync</em><b>{conn.syncedAt ? ago(conn.syncedAt) : '—'}</b></span>
            <span><em>Region</em><b>{conn.region.toUpperCase()}</b></span>
          </div>
          {conn.status === 'error' && <p className="ig-error">{conn.error}</p>}
          <div className="ig-actions">
            {openMap && <button className="primary" onClick={openMap}>Open fleet map</button>}
            <button disabled={!!busy} onClick={sync}>{busy === 'Syncing…' ? busy : 'Sync now'}</button>
            {owner && <button className="ghost" onClick={() => setOpen((x) => !x)}>Replace token</button>}
            {owner && <button className="ghost danger" onClick={disconnect}>Disconnect</button>}
          </div>
          <small className="ig-muted">Refreshes by itself every 2 minutes.</small>
        </div>
      )}

      {open && (
        <div className="ig-box ig-form">
          <b>{conn ? 'Replace the token' : `Connect ${info.name.split(' ')[0]}`}</b>
          <ol>{info.steps.map((s) => <li key={s}>{s}</li>)}</ol>
          <label className="ld-field">
            <span>{info.field}</span>
            <div className="ld-input"><input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Paste it here" autoFocus disabled={!owner || !data.ready} /></div>
          </label>
          <label className="ld-field ig-region">
            <span>Account region</span>
            <select value={region} onChange={(e) => setRegion(e.target.value)}>
              <option value="us">United States</option><option value="ca">Canada</option><option value="eu">Europe / UK</option>
            </select>
          </label>
          <div className="ig-actions">
            {conn && <button className="ghost" onClick={() => setOpen(false)}>Cancel</button>}
            <button className="primary" disabled={!!busy || !owner || token.trim().length < 10} onClick={() => void connect()}>{busy || 'Connect'}</button>
          </div>
          <small className="ig-muted">{owner ? `The token is checked with ${info.name.split(' ')[0]} first, then stored encrypted.` : 'Only the owner of the board can connect it.'}</small>
        </div>
      )}

      {conn && units.length > 0 && (
        <section className="ig-sub">
          <h3>Vehicles</h3>
          <UnitsTable units={units} state={state} owner={owner} refresh={refresh} toast={toast} />
        </section>
      )}
    </>
  )
}

function QuickBooksSetup({ data, owner, refresh, toast }: { data: Integrations; owner: boolean; refresh: () => void; toast: (m: string) => void }) {
  const conn = data.connections.find((c) => c.provider === 'quickbooks')
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn() } catch (e) { toast((e as Error).message) } finally { setBusy(false) } }
  if (!conn) return (
    <div className="ig-box">
      <div className="ig-actions">
        <button className="primary" disabled={busy || !owner} onClick={() => void run(async () => { location.href = (await crm.qboConnect()).url })}>Connect QuickBooks</button>
      </div>
      <small className="ig-muted">{owner ? 'You’ll sign in to QuickBooks and choose the company. Invoices you already sent go over too.' : 'Only the owner of the board can connect it.'}</small>
    </div>
  )
  return (
    <div className="ig-box">
      <div className="ig-stats">
        <span><em>Company</em><b>{conn.label || '—'}</b></span>
        <span><em>Invoices in QuickBooks</em><b>{conn.invoices ?? 0}</b></span>
        <span><em>Last check</em><b>{conn.syncedAt ? ago(conn.syncedAt) : '—'}</b></span>
      </div>
      {conn.status === 'error' && <p className="ig-error">{conn.error}</p>}
      {owner && (
        <div className="ig-actions">
          <button disabled={busy} onClick={() => void run(async () => { const r = await crm.qboSync(); toast(`${r.pushed} sent to QuickBooks · ${r.paid} marked paid`); refresh() })}>{busy ? 'Syncing…' : 'Sync now'}</button>
          {conn.status === 'error' && <button className="primary" disabled={busy} onClick={() => void run(async () => { location.href = (await crm.qboConnect()).url })}>Connect again</button>}
          <button className="ghost danger" disabled={busy} onClick={() => { if (confirm('Disconnect QuickBooks? Invoices already there stay in QuickBooks.')) void run(async () => { await crm.disconnect('quickbooks'); refresh() }) }}>Disconnect</button>
        </div>
      )}
      <small className="ig-muted">Payments are checked every 4 hours.</small>
    </div>
  )
}

function FactoringInfo({ state, openLoads }: { state: CrmState; openLoads?: () => void }) {
  const set = state.carriers.filter((c) => c.factoring || c.factoringEmail)
  return (
    <div className="ig-box">
      <b>How to send</b>
      <p className="ig-muted">Open a delivered load → <b>Invoice</b> → <b>Send to factoring</b>. Enter the factor’s email for invoices once — it’s saved on the carrier.</p>
      {set.length > 0 && (
        <ul className="ig-perms">{set.map((c) => <li key={c.id}>{c.name}{c.factoring ? ` → ${c.factoring}` : ''}{c.factoringEmail ? ` (${c.factoringEmail})` : ''}</li>)}</ul>
      )}
      {openLoads && <div className="ig-actions"><button className="primary" onClick={openLoads}>Go to Loads</button></div>}
    </div>
  )
}

function UnitsTable({ units, state, owner, refresh, toast }: { units: EldUnit[]; state: CrmState; owner: boolean; refresh: () => void; toast: (m: string) => void }) {
  const link = (u: EldUnit, v: string) => {
    const body = v === 'new' ? { create: true } : { truckId: v ? Number(v) : null }
    crm.linkUnit(u.provider, u.vehicleId, body).then(() => { if (v === 'new') toast(`Truck #${u.name} added`); refresh() }, (e: Error) => toast(e.message))
  }
  const unmatched = units.filter((u) => !u.truckId && u.linked !== 'none')
  const addAll = () => {
    if (!confirm(`Add ${unmatched.length} ${unmatched.length === 1 ? 'vehicle' : 'vehicles'} as trucks on your board?`)) return
    void Promise.all(unmatched.map((u) => crm.linkUnit(u.provider, u.vehicleId, { create: true }))).then(() => { toast(`${unmatched.length} trucks added`); refresh() }, (e: Error) => toast(e.message))
  }
  return (
    <div className="ig-units">
      <table className="lt-table">
        <thead><tr><th>Vehicle</th><th>Your truck</th><th>Driver</th><th>Where</th><th>Hours left</th></tr></thead>
        <tbody>
          {units.map((u) => (
            <tr key={u.vehicleId}>
              <td><b>{u.name || u.vehicleId}</b></td>
              <td>
                {owner ? (
                  <select className="pv-select" value={u.truckId ?? ''} onChange={(e) => link(u, e.target.value)} aria-label={`Truck for ${u.name}`}>
                    <option value="">{u.linked === 'none' ? 'Not ours' : '— not matched'}</option>
                    {state.trucks.map((t) => <option key={t.id} value={t.id}>#{t.unit || '—'} {t.driver}</option>)}
                    <option value="new">+ Add as a new truck</option>
                  </select>
                ) : (state.trucks.find((t) => t.id === u.truckId)?.unit ?? '—')}
              </td>
              <td>{u.driver || '—'}</td>
              <td className="ig-where">{u.address || '—'}{u.at && <small>{ago(u.at)}{u.speedMph ? ` · ${Math.round(u.speedMph)} mph` : ''}</small>}</td>
              <td className="ig-hos">{u.hos ? (
                <span className={u.hos.driveLeftMin != null && u.hos.driveLeftMin < 120 ? 'ig-low' : ''}>
                  {dutyLabel(u.hos.status) || '—'}{u.hos.driveLeftMin != null && ` · ${hoursLeft(u.hos.driveLeftMin)} drive`}
                  <small>{[u.hos.shiftLeftMin != null && `${hoursLeft(u.hos.shiftLeftMin)} shift`, u.hos.cycleLeftMin != null && `${hoursLeft(u.hos.cycleLeftMin)} cycle`, u.hos.breakLeftMin != null && `break in ${hoursLeft(u.hos.breakLeftMin)}`].filter(Boolean).join(' · ')}</small>
                </span>
              ) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {owner && unmatched.length > 0 && <button className="w-link" onClick={addAll}>+ Add {unmatched.length} unmatched {unmatched.length === 1 ? 'vehicle' : 'vehicles'} as trucks</button>}
    </div>
  )
}
