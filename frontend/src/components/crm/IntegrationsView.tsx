import { useCallback, useEffect, useState } from 'react'
import { crm, dutyLabel, hoursLeft, type CrmState, type EldProvider, type EldUnit, type Integrations } from '../../lib/crm'

// Integrations: connect the tools a dispatch office already pays for. Works today: Samsara (ELD) with the carrier's own
// API token, and "Send to factoring" by email for every factoring company. Partners that need their approval first are
// shown as "Requested", never as buttons that don't work.

const ago = (iso: string | null) => {
  if (!iso) return ''
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`
}

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

const SOON: { name: string; what: string; status: string }[] = [
  { name: 'Motive (KeepTruckin)', what: 'Trucks on your map and drivers’ hours of service', status: 'Partner approval requested' },
  { name: '123Loadboard', what: 'Search loads, post trucks and message brokers from HaulPanel', status: 'Partner access requested' },
  { name: 'DAT', what: 'Search loads, post trucks, lane rates', status: 'Partner access requested' },
  { name: 'Apex · OTR · HaulPay', what: 'Factoring status back in HaulPanel (sending works today by email)', status: 'Partner access requested' },
]

export function IntegrationsView({ state, owner, changed, toast }: { state: CrmState; owner: boolean; changed: () => void; toast: (m: string) => void }) {
  const [data, setData] = useState<Integrations | null>(null)
  const [err, setErr] = useState('')
  const load = useCallback(() => crm.integrations().then(setData, (e: Error) => setErr(e.message)), [])
  useEffect(() => { void load() }, [load])
  const refresh = () => { void load(); changed() }

  if (err) return <p className="w-msg error">{err}</p>
  if (!data) return <p className="w-msg">Loading…</p>
  const factorCarriers = state.carriers.filter((c) => c.factoring || c.factoringEmail)
  const soon = SOON.filter((s) => !(s.name.startsWith('Motive') && data.providers.includes('motive')))

  return (
    <div className="ig">
      <header className="ig-head">
        <h1>Integrations</h1>
        <p>Connect what your office already uses. HaulPanel only reads from your ELD — it never changes anything there.</p>
      </header>

      <section className="ig-sec">
        <h2>ELD &amp; GPS</h2>
        {!data.ready && <p className="ig-note">Integrations are being switched on for your account — check back shortly.</p>}
        <div className="ig-grid">
          {data.providers.map((p) => (
            <EldCard key={p} provider={p} data={data} state={state} owner={owner} ready={data.ready} refresh={refresh} toast={toast} />
          ))}
        </div>
      </section>

      <section className="ig-sec">
        <h2>Accounting</h2>
        <QuickBooksCard data={data} owner={owner} refresh={refresh} toast={toast} />
      </section>

      <section className="ig-sec">
        <h2>Factoring</h2>
        <div className="ig-card">
          <div className="ig-top">
            <span><b>Send to factoring — any factoring company</b><small>Works today, by email: one PDF with the invoice (“remit to” your factor), rate con, BOL and POD.</small></span>
            <em className="ig-badge ok">Works now</em>
          </div>
          <p className="ig-muted">
            Open a delivered load → <b>Invoice</b> → <b>Send to factoring</b>. Enter the factor’s email for invoices once; it’s saved on the carrier.
            {factorCarriers.length > 0 && <> Set up: {factorCarriers.map((c) => `${c.name}${c.factoring ? ` → ${c.factoring}` : ''}${c.factoringEmail ? ` (${c.factoringEmail})` : ''}`).join('; ')}.</>}
          </p>
        </div>
      </section>

      <section className="ig-sec">
        <h2>Coming next</h2>
        <div className="ig-list">
          {soon.map((s) => (
            <div key={s.name} className="ig-row">
              <span><b>{s.name}</b><small>{s.what}</small></span>
              <em className="ig-badge">{s.status}</em>
            </div>
          ))}
        </div>
        <p className="ig-muted">Until a connection is ready, an export file from any of these works in <b>Home → Import your data</b>.</p>
      </section>
    </div>
  )
}

function EldCard({ provider, data, state, owner, ready, refresh, toast }: {
  provider: EldProvider; data: Integrations; state: CrmState; owner: boolean; ready: boolean; refresh: () => void; toast: (m: string) => void
}) {
  const info = ELD[provider]
  const conn = data.connections.find((c) => c.provider === provider)
  const units = data.units.filter((u) => u.provider === provider)
  const [open, setOpen] = useState(false)
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
    <div className={`ig-card ${conn ? 'on' : ''}`}>
      <div className="ig-top">
        <span><b>{info.name}</b><small>{info.what}</small></span>
        {conn ? <em className={`ig-badge ${conn.status === 'ok' ? 'ok' : 'bad'}`}>{conn.status === 'ok' ? 'Connected' : 'Needs attention'}</em> : <em className="ig-badge">Not connected</em>}
      </div>

      {conn && (
        <>
          {conn.status === 'error' && <p className="ig-error">{conn.error}</p>}
          <p className="ig-muted">{units.length} {units.length === 1 ? 'vehicle' : 'vehicles'} · {units.filter((u) => u.truckId).length} matched to your trucks{conn.syncedAt ? ` · updated ${ago(conn.syncedAt)}` : ''} · refreshes every 2 minutes</p>
          {units.length > 0 && <UnitsTable units={units} state={state} owner={owner} refresh={refresh} toast={toast} />}
          <div className="ig-actions">
            <button disabled={!!busy} onClick={sync}>{busy === 'Syncing…' ? busy : 'Sync now'}</button>
            {owner && <button className="ghost" onClick={() => setOpen((x) => !x)}>Replace token</button>}
            {owner && <button className="ghost danger" onClick={disconnect}>Disconnect</button>}
          </div>
        </>
      )}

      {!conn && !open && (
        <div className="ig-actions">
          <button className="primary" disabled={!ready || !owner} onClick={() => setOpen(true)}>Connect {info.name.split(' ')[0]}</button>
          {!owner && <small className="ig-muted">Only the owner of the board can connect it.</small>}
        </div>
      )}

      {open && (
        <div className="ig-form">
          <ol>{info.steps.map((s) => <li key={s}>{s}</li>)}</ol>
          <label className="ld-field">
            <span>{info.field}</span>
            <div className="ld-input"><input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Paste it here" autoFocus /></div>
          </label>
          <label className="ld-field ig-region">
            <span>Account region</span>
            <select value={region} onChange={(e) => setRegion(e.target.value)}>
              <option value="us">United States</option><option value="ca">Canada</option><option value="eu">Europe / UK</option>
            </select>
          </label>
          <div className="ig-actions">
            <button className="ghost" onClick={() => setOpen(false)}>Cancel</button>
            <button className="primary" disabled={!!busy || token.trim().length < 10} onClick={() => void connect()}>{busy || 'Connect'}</button>
          </div>
          <small className="ig-muted">The token is checked with {info.name.split(' ')[0]} first and stored encrypted. Trucks are matched to yours by unit number; you can change any match below.</small>
        </div>
      )}
    </div>
  )
}

function QuickBooksCard({ data, owner, refresh, toast }: { data: Integrations; owner: boolean; refresh: () => void; toast: (m: string) => void }) {
  const conn = data.connections.find((c) => c.provider === 'quickbooks')
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn() } catch (e) { toast((e as Error).message) } finally { setBusy(false) } }
  return (
    <div className={`ig-card ${conn ? 'on' : ''}`}>
      <div className="ig-top">
        <span><b>QuickBooks Online</b><small>Every invoice you send from HaulPanel appears in QuickBooks; when it’s paid there, the load turns paid here.</small></span>
        {conn ? <em className={`ig-badge ${conn.status === 'ok' ? 'ok' : 'bad'}`}>{conn.status === 'ok' ? 'Connected' : 'Needs attention'}</em>
          : <em className="ig-badge">{data.quickbooks ? 'Not connected' : 'Coming soon'}</em>}
      </div>
      {conn ? (
        <>
          {conn.status === 'error' && <p className="ig-error">{conn.error}</p>}
          <p className="ig-muted">{conn.label ? `${conn.label} · ` : ''}{conn.invoices ?? 0} {conn.invoices === 1 ? 'invoice' : 'invoices'} in QuickBooks · payments checked every 4 hours{conn.syncedAt ? ` · last ${ago(conn.syncedAt)}` : ''}</p>
          {owner && (
            <div className="ig-actions">
              <button disabled={busy} onClick={() => void run(async () => { const r = await crm.qboSync(); toast(`${r.pushed} sent to QuickBooks · ${r.paid} marked paid`); refresh() })}>{busy ? 'Syncing…' : 'Sync now'}</button>
              {conn.status === 'error' && <button className="primary" disabled={busy} onClick={() => void run(async () => { location.href = (await crm.qboConnect()).url })}>Connect again</button>}
              <button className="ghost danger" disabled={busy} onClick={() => { if (confirm('Disconnect QuickBooks? Invoices already there stay in QuickBooks.')) void run(async () => { await crm.disconnect('quickbooks'); refresh() }) }}>Disconnect</button>
            </div>
          )}
        </>
      ) : data.quickbooks ? (
        <div className="ig-actions">
          <button className="primary" disabled={busy || !owner} onClick={() => void run(async () => { location.href = (await crm.qboConnect()).url })}>Connect QuickBooks</button>
          <small className="ig-muted">{owner ? 'You’ll sign in to QuickBooks and choose the company. Invoices you already sent go over too.' : 'Only the owner of the board can connect it.'}</small>
        </div>
      ) : (
        <p className="ig-muted">We’re finishing the QuickBooks connection. Until then, Reports → export works with QuickBooks import.</p>
      )}
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
