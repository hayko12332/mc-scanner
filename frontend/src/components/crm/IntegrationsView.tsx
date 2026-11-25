import { useCallback, useEffect, useState } from 'react'
import { crm, dutyLabel, hoursLeft, type CrmState, type EldProvider, type EldUnit, type Integrations } from '../../lib/crm'

// Integrations, laid out like an app marketplace: what's connected on top, then every integration as a card by
// category; a card opens its panel (what it does, what it may read, setup or the live connection). Works today:
// Samsara with the carrier's own API token, QuickBooks when switched on, "Send to factoring" by email and the
// driver's Telegram. Partners that must approve HaulPanel first say so — never a button that doesn't work.

const ago = (iso: string | null) => {
  if (!iso) return ''
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`
}

type Category = 'eld' | 'accounting' | 'factoring' | 'loadboards' | 'drivers'
const CATEGORIES: [Category | 'all', string][] = [
  ['all', 'All'], ['eld', 'ELD & GPS'], ['accounting', 'Accounting'], ['factoring', 'Factoring'], ['loadboards', 'Load boards'], ['drivers', 'Drivers'],
]
type Kind = 'eld' | 'quickbooks' | 'factoring' | 'telegram' | 'soon'
interface App {
  id: string; name: string; maker: string; category: Category; tile: string; tint: string; kind: Kind
  blurb: string; does: string[]; reads: string[]; pending?: string; provider?: EldProvider
}

const APPS: App[] = [
  {
    id: 'samsara', provider: 'samsara', kind: 'eld', name: 'Samsara', maker: 'Samsara Inc.', category: 'eld', tile: 'S', tint: '#0b2a4a',
    blurb: 'Live truck locations, drivers’ hours of service and GPS history on your fleet map.',
    does: ['Every truck on the fleet map, updated every 2 minutes, with speed and heading', 'Drivers’ HOS clocks — drive, shift, cycle, break — on each truck', 'The last 24 hours of GPS trail as soon as you connect', 'Brokers’ tracking links and ETAs use the ELD position', 'Trucks are matched to yours by unit number'],
    reads: ['Vehicles', 'Vehicle statistics (GPS)', 'Drivers', 'ELD compliance (HOS clocks)'],
  },
  {
    id: 'motive', provider: 'motive', kind: 'eld', name: 'Motive', maker: 'Motive Technologies (KeepTruckin)', category: 'eld', tile: 'M', tint: '#1c1c1e',
    blurb: 'Live truck locations and drivers’ available hours from Motive ELDs.',
    does: ['Every truck on the fleet map with speed and heading', 'Drivers’ available drive, shift, cycle and break time', 'Brokers’ tracking links use the ELD position'],
    reads: ['Vehicles', 'Vehicle locations', 'Users (drivers)', 'Available time (HOS)'],
    pending: 'Motive approves partner apps before their API can be used. Our request is in review.',
  },
  {
    id: 'quickbooks', kind: 'quickbooks', name: 'QuickBooks Online', maker: 'Intuit', category: 'accounting', tile: 'qb', tint: '#2ca01c',
    blurb: 'Invoices you send appear in QuickBooks; when they’re paid there, the load turns paid here.',
    does: ['Each invoice sent from HaulPanel is created in QuickBooks with the same number', 'Payments recorded in QuickBooks mark the load paid (checked every 4 hours)'],
    reads: ['Customers and invoices (create and read)', 'Payments (read)'],
    pending: 'We’re finishing the QuickBooks connection. Until then, Reports → Export works with QuickBooks import.',
  },
  {
    id: 'factoring', kind: 'factoring', name: 'Send to factoring', maker: 'Built into HaulPanel', category: 'factoring', tile: '$', tint: '#7c3aed',
    blurb: 'One PDF to any factoring company: invoice with their “remit to”, rate con, BOL and POD.',
    does: ['Works with every factoring company — by email, nothing to connect', 'The invoice carries the factor’s “remit to” line', 'Rate con, BOL and POD are attached in one PDF', 'The factor’s email is saved on the carrier'],
    reads: ['Nothing outside HaulPanel'],
  },
  {
    id: 'telegram', kind: 'telegram', name: 'Driver app on Telegram', maker: 'Built into HaulPanel', category: 'drivers', tile: '✈', tint: '#229ed9',
    blurb: 'Drivers share their location and send BOL / POD photos from Telegram — no app to install.',
    does: ['Live location from the driver’s phone when a truck has no ELD', 'BOL and POD photos go straight onto the load', 'The driver sees the load details and updates the status'],
    reads: ['Only what the driver chooses to share'],
  },
  {
    id: 'dat', kind: 'soon', name: 'DAT One', maker: 'DAT Freight & Analytics', category: 'loadboards', tile: 'DAT', tint: '#0046ad',
    blurb: 'Search loads, post trucks and see lane rates without leaving HaulPanel.',
    does: ['Load search with your trucks’ positions and hours', 'Post trucks', 'Lane rates next to the offer'], reads: ['Your DAT account (with your permission)'],
    pending: 'DAT gives API access to approved partners. Our request is in review.',
  },
  {
    id: '123lb', kind: 'soon', name: '123Loadboard', maker: '123Loadboard', category: 'loadboards', tile: '123', tint: '#e85d0c',
    blurb: 'Search loads, post trucks and message brokers from HaulPanel.',
    does: ['Load search', 'Post trucks', 'Message brokers'], reads: ['Your 123Loadboard account (with your permission)'],
    pending: '123Loadboard gives API access to approved partners. Our request is in review.',
  },
  {
    id: 'factor-status', kind: 'soon', name: 'Apex · OTR · HaulPay', maker: 'Factoring partners', category: 'factoring', tile: 'F', tint: '#475569',
    blurb: 'Factoring status and payments back in HaulPanel (sending already works by email).',
    does: ['Advance and payment status on each load', 'Reserve released shows on the statement'], reads: ['Your factoring account (with your permission)'],
    pending: 'These factors share data with approved partners. Our requests are in review.',
  },
]

type Status = { label: string; tone: 'ok' | 'bad' | 'muted' | 'built' }

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


function statusOf(app: App, data: Integrations, state: CrmState): Status {
  if (app.kind === 'eld') {
    const conn = data.connections.find((c) => c.provider === app.provider)
    if (conn) return conn.status === 'ok' ? { label: 'Connected', tone: 'ok' } : { label: 'Needs attention', tone: 'bad' }
    return data.providers.includes(app.provider!) ? { label: 'Available', tone: 'muted' } : { label: 'Partner review', tone: 'muted' }
  }
  if (app.kind === 'quickbooks') {
    const conn = data.connections.find((c) => c.provider === 'quickbooks')
    if (conn) return conn.status === 'ok' ? { label: 'Connected', tone: 'ok' } : { label: 'Needs attention', tone: 'bad' }
    return data.quickbooks ? { label: 'Available', tone: 'muted' } : { label: 'Coming soon', tone: 'muted' }
  }
  if (app.kind === 'factoring') return { label: 'Built in', tone: 'built' }
  if (app.kind === 'telegram') return (state.drivers?.length ?? 0) > 0 ? { label: `${state.drivers!.length} ${state.drivers!.length === 1 ? 'driver' : 'drivers'}`, tone: 'ok' } : { label: 'Built in', tone: 'built' }
  return { label: 'Partner review', tone: 'muted' }
}
const isLive = (app: App, data: Integrations) =>
  app.kind === 'factoring' || app.kind === 'telegram' || (app.kind === 'eld' && data.providers.includes(app.provider!)) || (app.kind === 'quickbooks' && data.quickbooks)

const Tile = ({ app, big }: { app: App; big?: boolean }) =>
  <span className={`ig-tile ${big ? 'big' : ''}`} style={{ background: app.tint }} aria-hidden="true">{app.tile}</span>

export function IntegrationsView({ state, owner, changed, toast, openTab }: {
  state: CrmState; owner: boolean; changed: () => void; toast: (m: string) => void
  /** Opens another section of the board (Trucks, Loads). */
  openTab?: (tab: 'trucks' | 'loads' | 'map') => void
}) {
  const [data, setData] = useState<Integrations | null>(null)
  const [err, setErr] = useState('')
  const [cat, setCat] = useState<Category | 'all'>('all')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const load = useCallback(() => crm.integrations().then(setData, (e: Error) => setErr(e.message)), [])
  useEffect(() => { void load() }, [load])
  const refresh = () => { void load(); changed() }

  if (err) return <p className="w-msg error">{err}</p>
  if (!data) return <p className="w-msg">Loading…</p>

  const apps = APPS
  const connected = apps.filter((a) => ['ok', 'bad'].includes(statusOf(a, data, state).tone) && (a.kind === 'eld' || a.kind === 'quickbooks'))
  const needle = q.trim().toLowerCase()
  const shown = apps
    .filter((a) => cat === 'all' || a.category === cat)
    .filter((a) => !needle || `${a.name} ${a.maker} ${a.blurb}`.toLowerCase().includes(needle))
    .sort((a, b) => Number(isLive(b, data)) - Number(isLive(a, data)))
  const app = apps.find((a) => a.id === open)

  return (
    <div className="ig">
      <header className="ig-head">
        <div>
          <h1>Integrations</h1>
          <p>Connect the tools your office already uses. Read-only where it matters — HaulPanel never changes anything in your ELD.</p>
        </div>
        <input className="ig-search" type="search" placeholder="Search integrations" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search integrations" />
      </header>
      {!data.ready && <p className="ig-note">Integrations are being switched on for your account — check back shortly.</p>}

      {connected.length > 0 && (
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
                    <small>{a.kind === 'eld' ? `${units.length} ${units.length === 1 ? 'vehicle' : 'vehicles'} · ${units.filter((u) => u.truckId).length} matched` : `${conn?.invoices ?? 0} invoices`}{conn?.syncedAt ? ` · synced ${ago(conn.syncedAt)}` : ''}</small>
                  </span>
                  <em className={`ig-pill ${st.tone}`}><i />{st.label}</em>
                  <span className="ig-manage">Manage →</span>
                </button>
              )
            })}
          </div>
        </section>
      )}

      <section className="ig-sec">
        <div className="ig-tabs" role="tablist" aria-label="Categories">
          {CATEGORIES.map(([c, label]) => (
            <button key={c} role="tab" aria-selected={cat === c} className={cat === c ? 'on' : ''} onClick={() => setCat(c)}>
              {label}<em>{c === 'all' ? apps.length : apps.filter((a) => a.category === c).length}</em>
            </button>
          ))}
        </div>
        <div className="ig-cards">
          {shown.map((a) => {
            const st = statusOf(a, data, state)
            const live = isLive(a, data)
            return (
              <button key={a.id} className={`ig-app ${live ? '' : 'soon'}`} onClick={() => setOpen(a.id)}>
                <span className="ig-app-top">
                  <Tile app={a} />
                  <span><b>{a.name}</b><small>{CATEGORIES.find(([c]) => c === a.category)?.[1]} · {a.maker}</small></span>
                </span>
                <span className="ig-app-blurb">{a.blurb}</span>
                <span className="ig-app-foot">
                  <em className={`ig-pill ${st.tone}`}><i />{st.label}</em>
                  <span className="ig-app-cta">{st.tone === 'ok' || st.tone === 'bad' ? 'Manage' : live ? (a.kind === 'eld' || a.kind === 'quickbooks' ? 'Connect' : 'Set up') : 'Details'} →</span>
                </span>
              </button>
            )
          })}
          {!shown.length && <p className="ig-muted">Nothing matches “{q}”.</p>}
        </div>
        <p className="ig-muted ig-foot">Missing a tool? Until a connection is ready, an export file from it works in <b>Home → Import your data</b>. Tell us what you use — reply to any HaulPanel email.</p>
      </section>

      {app && <AppPanel app={app} data={data} state={state} owner={owner} refresh={refresh} toast={toast} openTab={openTab} close={() => setOpen(null)} />}
    </div>
  )
}

/** The side panel of one integration: about, permissions, then setup or the live connection. */
function AppPanel({ app, data, state, owner, refresh, toast, openTab, close }: {
  app: App; data: Integrations; state: CrmState; owner: boolean; refresh: () => void; toast: (m: string) => void
  openTab?: (tab: 'trucks' | 'loads' | 'map') => void; close: () => void
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    addEventListener('keydown', esc)
    return () => removeEventListener('keydown', esc)
  }, [close])
  const st = statusOf(app, data, state)
  const live = isLive(app, data)
  return (
    <div className="ld-backdrop" onClick={close}>
      <aside className="ld ig-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={app.name}>
        <header className="ig-panel-head">
          <Tile app={app} big />
          <div className="ig-panel-title"><small>{app.maker}</small><h2>{app.name}</h2><em className={`ig-pill ${st.tone}`}><i />{st.label}</em></div>
          <button className="ld-x" onClick={close} aria-label="Close">×</button>
        </header>
        <div className="ig-panel-body">
          <p className="ig-lead">{app.blurb}</p>

          {app.kind === 'eld' && live && <EldSetup provider={app.provider!} data={data} state={state} owner={owner} refresh={refresh} toast={toast} openMap={openTab ? () => openTab('map') : undefined} />}
          {app.kind === 'quickbooks' && live && <QuickBooksSetup data={data} owner={owner} refresh={refresh} toast={toast} />}
          {app.kind === 'factoring' && <FactoringInfo state={state} openLoads={openTab ? () => { close(); openTab('loads') } : undefined} />}
          {app.kind === 'telegram' && (
            <div className="ig-box">
              <b>Set up</b>
              <p className="ig-muted">Open <b>Trucks</b>, press <b>+ Connect driver’s Telegram</b> on a truck and send the driver the link. They tap it once in Telegram — that’s all.</p>
              {openTab && <div className="ig-actions"><button className="primary" onClick={() => { close(); openTab('trucks') }}>Go to Trucks</button></div>}
            </div>
          )}
          {!live && app.pending && <div className="ig-box ig-wait"><b>Not available yet</b><p className="ig-muted">{app.pending}</p></div>}

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
