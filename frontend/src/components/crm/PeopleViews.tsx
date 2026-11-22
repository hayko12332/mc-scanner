import { useState, type FormEvent } from 'react'
import { api } from '../../api'
import {
  addDays, dutyLabel, feeLabel, fmtMiles, fmtRpm, gross, hoursLeft, rpm, today, usd, weekStart,
  type CarrierInput, type CrmCarrier, type CrmState, type Dispatcher, type FeeType, type Truck, type TruckInput,
} from '../../lib/crm'
import { formatPhone } from '../../lib/format'
import { Icon } from '../Icon'
import { EditSelect, EditText } from './LoadsTable'
import { CheckBadge, savedCheck, useCheck } from './CheckBadge'
import type { CheckRole, CompanyCheck } from '../../lib/crm'

/** A carrier's FMCSA check under its name (re-checked daily on the server; the owner is emailed when it gets worse). */
function CarrierCheck({ state, mc, run }: { state: CrmState; mc: string; run: (mc: string, role: CheckRole) => Promise<CompanyCheck> }) {
  const r = useCheck(mc, 'carrier', run, savedCheck(state, mc, 'carrier'))
  if (mc.replace(/\D/g, '').length < 3) return null
  return <div className="pv-check"><CheckBadge {...r} /></div>
}

const blankCarrier: CarrierInput = { name: '', mc: '', dot: '', phone: '', email: '', notes: '', feeType: 'percent', fee: 0, factoring: '' }

/** Loads, miles and gross this week and this month for one carrier, truck or dispatcher. */
function totals(state: CrmState, key: 'carrierId' | 'dispatcherId' | 'truckId', id: number) {
  const week = weekStart(today())
  const weekEnd = addDays(week, 6)
  const month = today().slice(0, 7)
  let week$ = 0, weekLoads = 0, weekMiles = 0, weekMiles$ = 0, month$ = 0, all = 0
  for (const l of state.loads) {
    if (l[key] !== id) continue
    all++
    if (l.date >= week && l.date <= weekEnd) {
      week$ += gross(l)
      weekLoads++
      weekMiles += l.loadedMiles
      if (l.loadedMiles) weekMiles$ += gross(l)
    }
    if (l.date.startsWith(month)) month$ += gross(l)
  }
  return { week: week$, weekLoads, weekMiles, weekRpm: rpm(weekMiles$, weekMiles), month: month$, all }
}

/** "8", "8%" → 8% of gross; "$300", "300/wk", "300 a week" → $300 flat per week. */
export function parseFee(text: string): { feeType: FeeType; fee: number } {
  const flat = /\$|\/\s*w|wk|week|flat/i.test(text)
  const fee = Math.max(0, Number(text.replace(/[^\d.]/g, '')) || 0)
  return flat ? { feeType: 'flat', fee } : { feeType: 'percent', fee: Math.min(fee, 100) }
}
const feeShort = (c: CrmCarrier) => (!c.fee ? '' : c.feeType === 'flat' ? `${usd(c.fee)}/wk` : `${c.fee}%`)

const RemoveButton = ({ name, onRemove }: { name: string; onRemove: () => void }) => (
  <button className="row-del" title="Remove" aria-label={`Remove ${name}`}
    onClick={() => confirm(`Remove ${name}? Their loads stay in the journal.`) && onRemove()}>×</button>
)

/** Carriers the dispatcher works for: add by MC (filled from FMCSA) or by hand; every cell edits in place. */
export function CarriersView({ state, add, update, remove, check }: {
  state: CrmState
  check: (mc: string, role: CheckRole) => Promise<CompanyCheck>
  add: (c: CarrierInput) => Promise<unknown>
  update: (c: CrmCarrier) => Promise<unknown>
  remove: (id: number) => Promise<unknown>
}) {
  const [v, setV] = useState<CarrierInput>(blankCarrier)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const set = (k: keyof CarrierInput, value: string) => setV((x) => ({ ...x, [k]: value }))
  const save = (c: CrmCarrier, patch: Partial<CarrierInput>) => { update({ ...c, ...patch }).catch(() => undefined) }

  const fill = async () => {
    const mc = v.mc.replace(/\D/g, '')
    if (!mc) return setNote('Enter an MC number first')
    setNote('Looking up MC…')
    try {
      const r = await api.lookup(mc, 'mc')
      const c = r.profiles[0]
      if (!c) return setNote('No carrier found for this MC')
      setV((x) => ({ ...x, name: c.legalName, dot: c.dot, phone: formatPhone(c.phone || c.cellPhone), email: c.email }))
      setNote('Filled from FMCSA — check and press Add')
    } catch (e) {
      setNote((e as Error).message)
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await add(v)
      setV(blankCarrier)
      setNote('')
    } finally {
      setBusy(false)
    }
  }

  const rows = state.carriers.map((c) => ({ c, t: totals(state, 'carrierId', c.id) }))
  const sum = (k: 'week' | 'month') => rows.reduce((s, r) => s + r.t[k], 0)

  return (
    <div className="lt">
      <form className="pv-add" onSubmit={submit}>
        <b>Add carrier</b>
        <input className="w-mc" placeholder="MC number" aria-label="MC" value={v.mc} onChange={(e) => set('mc', e.target.value)} />
        <button type="button" className="ghost" onClick={fill}><Icon name="search" size={14} />Fill from FMCSA</button>
        <input className="w-grow" required placeholder="Carrier name" aria-label="Name" value={v.name} onChange={(e) => set('name', e.target.value)} />
        <input placeholder="USDOT" aria-label="USDOT" value={v.dot} onChange={(e) => set('dot', e.target.value)} />
        <input placeholder="Phone" aria-label="Phone" value={v.phone} onChange={(e) => set('phone', e.target.value)} />
        <input className="w-grow" type="email" placeholder="Email" aria-label="Email" value={v.email} onChange={(e) => set('email', e.target.value)} />
        <button className="primary" disabled={busy}>+ Add carrier</button>
      </form>
      {note && <p className="pv-note">{note}</p>}

      <div className="lt-scroll">
        <table className="lt-table pv-table">
          <colgroup>
            <col /><col style={{ width: '9%' }} /><col style={{ width: '11%' }} /><col style={{ width: '17%' }} /><col style={{ width: '9%' }} />
            <col style={{ width: '11%' }} /><col style={{ width: '6%' }} /><col style={{ width: '9%' }} /><col style={{ width: '9%' }} /><col style={{ width: '48px' }} />
          </colgroup>
          <thead>
            <tr>
              <th>Carrier</th><th>MC</th><th>Phone</th><th>Email</th>
              <th className="num" title="Dispatch fee: a percent of gross (8%) or a flat amount per week ($300/wk)">Fee</th><th>Factoring</th>
              <th className="num">Trucks</th><th className="num">This week</th><th className="num">This month</th><th />
            </tr>
          </thead>
          <tbody>
            {!rows.length && <tr className="lt-empty"><td colSpan={10}>No carriers yet. Add one by MC above — each carrier works like a tab of your spreadsheet.</td></tr>}
            {rows.map(({ c, t }) => (
              <tr key={c.id} className="lt-row">
                <td className="pv-name"><EditText value={c.name} onSave={(x) => x && save(c, { name: x })} /><CarrierCheck state={state} mc={c.mc} run={check} /></td>
                <td className="pv-muted"><EditText value={c.mc} display={c.mc.replace(/\D/g, '') || undefined} onSave={(x) => save(c, { mc: x })} /></td>
                <td><EditText value={c.phone} onSave={(x) => save(c, { phone: x })} /></td>
                <td><EditText value={c.email} onSave={(x) => save(c, { email: x })} /></td>
                <td className="num-edit" title={feeLabel(c)}>
                  <EditText align="right" value={feeShort(c)} placeholder="set" onSave={(x) => save(c, parseFee(x))} />
                </td>
                <td className="pv-muted"><EditText value={c.factoring} placeholder="none" onSave={(x) => save(c, { factoring: x })} /></td>
                <td className="num">{state.trucks.filter((tr) => tr.carrierId === c.id).length || '—'}</td>
                <td className="num">{usd(t.week)}</td>
                <td className="num strong">{usd(t.month)}</td>
                <td className="c-del"><RemoveButton name={c.name} onRemove={() => void remove(c.id)} /></td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={6}>{rows.length} {rows.length === 1 ? 'carrier' : 'carriers'} · fee: type “8%” or “$300/wk” · authority and insurance re-checked daily, you get an email if something changes</td>
                <td className="num">{state.trucks.filter((tr) => tr.carrierId != null).length}</td>
                <td className="num">{usd(sum('week'))}</td>
                <td className="num wk-gross">{usd(sum('month'))}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}

/** Dispatchers (the BB column) and the percent each one earns; name and percent edit in place. */
export interface TeamActions {
  invite: (dispatcherId: number, email: string) => Promise<unknown>
  cancel: (inviteId: number) => Promise<unknown>
  removeMember: (userId: number) => Promise<unknown>
}

/** A dispatcher's own sign-in: invite them by email; they then see only their own loads, documents and pay. */
function TeamAccess({ d, state, team }: { d: Dispatcher; state: CrmState; team: TeamActions }) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const member = state.team?.members.find((m) => m.dispatcherId === d.id)
  const invite = state.team?.invites.find((i) => i.dispatcherId === d.id)
  if (member) return (
    <div className="tm"><span className="tm-on">✓ Signs in as {member.email}</span>
      <button className="w-link" onClick={() => { if (confirm(`Remove ${member.email}’s access to this board?`)) void team.removeMember(member.userId) }}>Remove access</button></div>
  )
  if (invite && !open) return (
    <div className="tm"><span className="tm-wait">Invite sent to {invite.email}</span>
      <button className="w-link" onClick={() => { setEmail(invite.email); setOpen(true) }}>Resend</button>
      <button className="w-link" onClick={() => void team.cancel(invite.id)}>Cancel</button></div>
  )
  if (!open) return <div className="tm"><button className="w-link" onClick={() => setOpen(true)}>+ Invite to sign in</button></div>
  return (
    <form className="tm tm-form" onSubmit={(e) => { e.preventDefault(); void team.invite(d.id, email.trim()).then(() => setOpen(false), () => undefined) }}>
      <input type="email" required autoFocus placeholder={`${d.name.toLowerCase().replace(/\W+/g, '')}@email.com`} value={email} onChange={(e) => setEmail(e.target.value)} />
      <button className="primary">Send invite</button>
      <button type="button" className="w-link" onClick={() => setOpen(false)}>Cancel</button>
    </form>
  )
}

export function DispatchersView({ state, add, save, remove, team }: {
  state: CrmState
  add: (d: Omit<Dispatcher, 'id'>) => Promise<unknown>
  save: (d: Dispatcher) => Promise<unknown>
  remove: (id: number) => Promise<unknown>
  /** Owner only (not in the demo): invite each dispatcher to their own sign-in. */
  team?: TeamActions
}) {
  const [name, setName] = useState('')
  const [percent, setPercent] = useState('')
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    await add({ name: name.trim(), percent: Number(percent) || 0 })
    setName('')
    setPercent('')
  }
  const update = (d: Dispatcher, patch: Partial<Dispatcher>) => { save({ ...d, ...patch }).catch(() => undefined) }

  const rows = state.dispatchers.map((d) => {
    const t = totals(state, 'dispatcherId', d.id)
    return { d, t, payWeek: (t.week * d.percent) / 100, payMonth: (t.month * d.percent) / 100 }
  })
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + f(r), 0)

  return (
    <div className="lt">
      <form className="pv-add" onSubmit={submit}>
        <b>Add dispatcher</b>
        <input className="w-grow" required placeholder="Name, e.g. Sergo" aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <label className="pv-pct"><input inputMode="decimal" placeholder="5" aria-label="Percent of each load" value={percent} onChange={(e) => setPercent(e.target.value)} /><span>% of each load</span></label>
        <button className="primary">+ Add dispatcher</button>
      </form>

      <div className="lt-scroll">
        <table className="lt-table pv-table">
          <colgroup>
            <col /><col style={{ width: '10%' }} /><col style={{ width: '12%' }} /><col style={{ width: '14%' }} />
            <col style={{ width: '13%' }} /><col style={{ width: '13%' }} /><col style={{ width: '48px' }} />
          </colgroup>
          <thead>
            <tr>
              <th>Dispatcher</th><th className="num">Percent</th><th className="num">Loads this week</th><th className="num">Booked this week</th>
              <th className="num">Pay this week</th><th className="num">Pay this month</th><th />
            </tr>
          </thead>
          <tbody>
            {!rows.length && <tr className="lt-empty"><td colSpan={7}>No dispatchers yet. Each one gets their own percent of the loads they book.</td></tr>}
            {rows.map(({ d, t, payWeek, payMonth }) => (
              <tr key={d.id} className="lt-row">
                <td className="pv-name"><EditText value={d.name} onSave={(x) => x && update(d, { name: x })} />{team && <TeamAccess d={d} state={state} team={team} />}</td>
                <td className="num-edit"><EditText align="right" value={String(d.percent)} display={`${d.percent}%`} onSave={(x) => update(d, { percent: Number(x.replace(/[%\s]/g, '')) || 0 })} /></td>
                <td className="num">{t.weekLoads}</td>
                <td className="num">{usd(t.week)}</td>
                <td className="num strong">{usd(Math.round(payWeek))}</td>
                <td className="num">{usd(Math.round(payMonth))}</td>
                <td className="c-del"><RemoveButton name={d.name} onRemove={() => void remove(d.id)} /></td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={2}>{rows.length} {rows.length === 1 ? 'dispatcher' : 'dispatchers'}</td>
                <td className="num">{sum((r) => r.t.weekLoads)}</td>
                <td className="num">{usd(sum((r) => r.t.week))}</td>
                <td className="num wk-gross">{usd(Math.round(sum((r) => r.payWeek)))}</td>
                <td className="num">{usd(Math.round(sum((r) => r.payMonth)))}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}

/** Trucks and drivers of the carriers: what each truck grossed this week, its miles and RPM. */
export interface DriverActions { link: (truckId: number) => Promise<{ url: string }>; disconnect: (truckId: number) => Promise<unknown> }

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`
}

/** The driver's Telegram: a link to send them once; then their status, photos and location come in by themselves. */
function DriverApp({ t, state, actions }: { t: Truck; state: CrmState; actions: DriverActions }) {
  const [url, setUrl] = useState('')
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState(false)
  const driver = state.drivers?.find((d) => d.truckId === t.id)
  const pos = state.positions?.find((p) => p.truckId === t.id)
  if (driver) return (
    <div className="tm">
      <span className="tm-on">✓ {driver.name || 'Driver'} on Telegram{pos ? ` · ${pos.live ? '📍 live, ' : '📍 '}${ago(pos.at)}` : ''}</span>
      <button className="w-link" onClick={() => { if (confirm('Disconnect this driver’s Telegram from the truck?')) void actions.disconnect(t.id) }}>Disconnect</button>
    </div>
  )
  if (url) {
    const msg = `Hi${t.driver ? ` ${t.driver.split(' ')[0]}` : ''}, tap this link to connect to our dispatch in Telegram (loads, BOL/POD photos, location): ${url}`
    return (
      <div className="tm tm-link">
        <code title={url}>{url.replace(/^https:\/\//, '')}</code>
        <button className="w-link" onClick={() => void navigator.clipboard.writeText(msg).then(() => setCopied(true))}>{copied ? 'Copied ✓' : 'Copy message'}</button>
        {t.phone && <a className="w-link" href={`sms:${t.phone.replace(/[^\d+]/g, '')}?&body=${encodeURIComponent(msg)}`}>Text it</a>}
      </div>
    )
  }
  return (
    <div className="tm">
      <button className="w-link" onClick={() => void actions.link(t.id).then((r) => setUrl(r.url), (e: Error) => setErr(e.message))}>+ Connect driver’s Telegram</button>
      {err && <span className="tm-wait">{err}</span>}
    </div>
  )
}

/** What the truck's ELD says now: where it is, and the driver's duty status and hours left. */
function EldLine({ t, state }: { t: Truck; state: CrmState }) {
  const u = state.eld?.find((x) => x.truckId === t.id)
  if (!u) return null
  const low = u.hos?.driveLeftMin != null && u.hos.driveLeftMin < 120
  return (
    <div className="tm tm-eld">
      <span className="tm-on" title={`${u.provider === 'samsara' ? 'Samsara' : 'Motive'} · vehicle ${u.name}`}>
        📍 {u.address || 'Location unknown'}{u.at ? ` · ${ago(u.at)}` : ''}{u.speedMph ? ` · ${Math.round(u.speedMph)} mph` : ''}
      </span>
      {u.hos && (
        <span className={`tm-hos ${low ? 'low' : ''}`}>
          {dutyLabel(u.hos.status) || 'HOS'}{u.hos.driveLeftMin != null && ` · ${hoursLeft(u.hos.driveLeftMin)} drive`}{u.hos.cycleLeftMin != null && ` · ${hoursLeft(u.hos.cycleLeftMin)} cycle`}
        </span>
      )}
    </div>
  )
}

export function TrucksView({ state, add, update, remove, drivers }: {
  state: CrmState
  /** Not in the demo: connect each driver's Telegram. */
  drivers?: DriverActions
  add: (t: TruckInput) => Promise<unknown>
  update: (t: Truck) => Promise<unknown>
  remove: (id: number) => Promise<unknown>
}) {
  const blank = { unit: '', carrierId: state.carriers.length === 1 ? String(state.carriers[0].id) : '', driver: '', phone: '' }
  const [v, setV] = useState(blank)
  const set = (k: keyof typeof v, value: string) => setV((x) => ({ ...x, [k]: value }))
  const save = (t: Truck, patch: Partial<TruckInput>) => { update({ ...t, ...patch }).catch(() => undefined) }
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    await add({ unit: v.unit.trim(), driver: v.driver.trim(), phone: v.phone.trim(), carrierId: v.carrierId ? Number(v.carrierId) : null })
    setV((x) => ({ ...blank, carrierId: x.carrierId }))
  }
  const carrierName = new Map(state.carriers.map((c) => [c.id, c.name]))
  const rows = state.trucks
    .map((t) => ({ t, s: totals(state, 'truckId', t.id) }))
    .sort((a, b) => (carrierName.get(a.t.carrierId ?? -1) ?? '').localeCompare(carrierName.get(b.t.carrierId ?? -1) ?? '')
      || a.t.unit.localeCompare(b.t.unit, undefined, { numeric: true }))
  const sum = (k: 'week' | 'month' | 'weekMiles' | 'weekLoads') => rows.reduce((x, r) => x + r.s[k], 0)

  return (
    <div className="lt">
      <form className="pv-add" onSubmit={submit}>
        <b>Add truck</b>
        <input className="w-mc" placeholder="Truck #" aria-label="Truck number" value={v.unit} onChange={(e) => set('unit', e.target.value)} />
        <select className="pv-select" aria-label="Carrier" value={v.carrierId} onChange={(e) => set('carrierId', e.target.value)}>
          <option value="">Carrier</option>
          {state.carriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input className="w-grow" placeholder="Driver" aria-label="Driver" value={v.driver} onChange={(e) => set('driver', e.target.value)} />
        <input placeholder="Driver phone" aria-label="Driver phone" value={v.phone} onChange={(e) => set('phone', e.target.value)} />
        <button className="primary" disabled={!v.unit.trim() && !v.driver.trim()}>+ Add truck</button>
      </form>

      <div className="lt-scroll">
        <table className="lt-table pv-table">
          <colgroup>
            <col style={{ width: '8%' }} /><col style={{ width: '14%' }} /><col /><col style={{ width: '11%' }} />
            <col style={{ width: '6%' }} /><col style={{ width: '7%' }} /><col style={{ width: '9%' }} /><col style={{ width: '7%' }} /><col style={{ width: '9%' }} /><col style={{ width: '48px' }} />
          </colgroup>
          <thead>
            <tr>
              <th>Truck</th><th>Carrier</th><th>Driver</th><th>Phone</th>
              <th className="num">Loads</th><th className="num">Miles</th><th className="num">Gross</th><th className="num">RPM</th>
              <th className="num">This month</th><th />
            </tr>
            <tr className="pv-sub"><th colSpan={4} /><th colSpan={4} className="pv-group">this week</th><th colSpan={2} /></tr>
          </thead>
          <tbody>
            {!rows.length && <tr className="lt-empty"><td colSpan={10}>No trucks yet. Add each truck and its driver to see weekly gross per truck and plan deadhead.</td></tr>}
            {rows.map(({ t, s }) => (
              <tr key={t.id} className="lt-row">
                <td className="pv-name"><EditText value={t.unit} display={t.unit ? `#${t.unit}` : undefined} onSave={(x) => save(t, { unit: x })} /></td>
                <td>
                  <EditSelect value={String(t.carrierId ?? '')} label="Carrier" onSave={(x) => save(t, { carrierId: x ? Number(x) : null })}
                    options={[['', '—'], ...state.carriers.map((c): [string, string] => [String(c.id), c.name])]} />
                </td>
                <td><EditText value={t.driver} onSave={(x) => save(t, { driver: x })} /><EldLine t={t} state={state} />{drivers && !state.eld?.some((u) => u.truckId === t.id) && <DriverApp t={t} state={state} actions={drivers} />}</td>
                <td><EditText value={t.phone} onSave={(x) => save(t, { phone: x })} /></td>
                <td className="num">{s.weekLoads}</td>
                <td className="num">{fmtMiles(s.weekMiles)}</td>
                <td className="num strong">{usd(s.week)}</td>
                <td className="num">{fmtRpm(s.weekRpm)}</td>
                <td className="num">{usd(s.month)}</td>
                <td className="c-del"><RemoveButton name={t.unit ? `truck #${t.unit}` : t.driver} onRemove={() => void remove(t.id)} /></td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={4}>{rows.length} {rows.length === 1 ? 'truck' : 'trucks'}</td>
                <td className="num">{sum('weekLoads')}</td>
                <td className="num">{fmtMiles(sum('weekMiles'))}</td>
                <td className="num wk-gross">{usd(sum('week'))}</td>
                <td className="num" />
                <td className="num">{usd(sum('month'))}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}
