import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { saveFile } from '../../lib/export'
import {
  addDays, carrierFee, extras, fmtMiles, fmtRpm, gross, LOAD_EXTRAS, overdueDays, rpm, shortDate, STATUSES, today, usd, weekStart,
  withStatusDates, type CrmState, type ImportRow, type Load, type LoadInput, type LoadStatus,
} from '../../lib/crm'
import { buildXlsx } from '../../lib/xlsx'
import { Icon } from '../Icon'
import { ImportDialog } from './ImportDialog'

type Period = 'week' | 'last' | 'month' | 'all'
type SortKey = 'date' | 'carrier' | 'broker' | 'rate' | 'miles' | 'rpm' | 'dispatcher' | 'status'
type Tab = LoadStatus | 'all' | 'overdue'

const PERIODS: [Period, string][] = [['week', 'This week'], ['last', 'Last week'], ['month', 'This month'], ['all', 'All time']]
const statusLabel = (s: LoadStatus) => STATUSES.find((x) => x.id === s)?.label ?? s
const money = (s: string) => Number(s.replace(/[$,\s]/g, '')) || 0
const whole = (s: string) => Math.max(0, Math.round(Number(s.replace(/[,\s]/g, '')) || 0))

/** "SHOW LOW, AZ 85901" → "Show Low, AZ 85901"; text typed in mixed case is left alone. */
export function place(s: string) {
  if (!s || /[a-z]/.test(s)) return s
  return s.toLowerCase().replace(/\b([a-z])([a-z]*)\b/g, (w, a: string, b: string) => (w.length <= 2 ? w.toUpperCase() : a.toUpperCase() + b))
}

/** Date range of a period, and of the period before it (for "vs last week"). */
function range(p: Period): { cur: [string, string] | null; prev: [string, string] | null; label: string } {
  const week = weekStart(today())
  if (p === 'week') return { cur: [week, addDays(week, 6)], prev: [addDays(week, -7), addDays(week, -1)], label: 'vs last week' }
  if (p === 'last') return { cur: [addDays(week, -7), addDays(week, -1)], prev: [addDays(week, -14), addDays(week, -8)], label: 'vs week before' }
  if (p === 'month') {
    const m = today().slice(0, 7)
    const d = new Date(m + '-15T12:00:00Z')
    d.setUTCMonth(d.getUTCMonth() - 1)
    const pm = d.toISOString().slice(0, 7)
    return { cur: [m + '-01', m + '-31'], prev: [pm + '-01', pm + '-31'], label: 'vs last month' }
  }
  return { cur: null, prev: null, label: '' }
}
const inRange = (l: Load, r: [string, string] | null) => !r || (l.date >= r[0] && l.date <= r[1])

/** A cell that turns into an input on click; Enter or leaving the cell saves, Esc cancels. */
export function EditText({ value, onSave, display, align, type = 'text', placeholder = '—' }: {
  value: string; onSave: (v: string) => void; display?: ReactNode; align?: 'right'; type?: 'text' | 'date'; placeholder?: string
}) {
  const [editing, setEditing] = useState(false)
  const [v, setV] = useState(value)
  if (!editing) {
    return (
      <button type="button" className={`cell-btn ${align ?? ''} ${value ? '' : 'is-empty'}`} onClick={() => { setV(value); setEditing(true) }}>
        {display ?? (value || placeholder)}
      </button>
    )
  }
  const done = (save: boolean) => {
    setEditing(false)
    if (save && v.trim() !== value) onSave(v.trim())
  }
  return (
    <input
      className={`cell-input ${align ?? ''}`} type={type} value={v} autoFocus
      onChange={(e) => setV(e.target.value)}
      onBlur={() => done(true)}
      onKeyDown={(e) => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false) }}
    />
  )
}

export function EditSelect({ value, options, onSave, label }: { value: string; options: [string, string][]; onSave: (v: string) => void; label?: string }) {
  return (
    <select className="cell-select" value={value} aria-label={label} onChange={(e) => onSave(e.target.value)}>
      {options.map(([id, text]) => <option key={id} value={id}>{text}</option>)}
    </select>
  )
}

interface Props {
  state: CrmState
  addLoad: (l: LoadInput) => Promise<unknown>
  updateLoad: (id: number, l: LoadInput) => Promise<unknown>
  /** Applies a change to several loads; the change can depend on each load (e.g. keep its own invoice date). */
  updateMany: (loads: Load[], patch: (l: Load) => Partial<LoadInput>) => Promise<unknown>
  removeMany: (ids: number[]) => Promise<unknown>
  importLoads: (rows: ImportRow[]) => Promise<unknown>
  openLoad: (id: number) => void
}

/** The load journal: status tabs, filters, KPIs, an editable table with weekly subtotals, bulk actions. */
export function LoadsTable({ state, addLoad, updateLoad, updateMany, removeMany, importLoads, openLoad }: Props) {
  const { carriers, dispatchers, trucks } = state
  const [tab, setTab] = useState<Tab>('all')
  const [period, setPeriod] = useState<Period>('all')
  const [carrierId, setCarrierId] = useState('')
  const [dispatcherId, setDispatcherId] = useState('')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'date', desc: true })
  const [importing, setImporting] = useState(false)
  const [adding, setAdding] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const carrierById = useMemo(() => new Map(carriers.map((c) => [c.id, c])), [carriers])
  const truckById = useMemo(() => new Map(trucks.map((t) => [t.id, t])), [trucks])
  const dispatcherName = useMemo(() => new Map(dispatchers.map((d) => [d.id, d.name])), [dispatchers])
  const percent = useMemo(() => new Map(dispatchers.map((d) => [d.id, d.percent])), [dispatchers])
  const pay = (l: Load) => (l.dispatcherId != null ? (gross(l) * (percent.get(l.dispatcherId) ?? 0)) / 100 : 0)
  const truckLabel = (id: number | null) => {
    const t = id == null ? null : truckById.get(id)
    return t ? (t.unit ? `#${t.unit}` : t.driver) : ''
  }

  // "N" opens the new-load row, unless you are typing somewhere.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.key.toLowerCase() === 'n' && !e.metaKey && !e.ctrlKey && !/INPUT|SELECT|TEXTAREA/.test(t.tagName)) {
        e.preventDefault()
        setAdding(true)
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])

  const r = range(period)
  const filtersOk = (l: Load) => {
    const needle = q.trim().toLowerCase()
    const t = l.truckId == null ? null : truckById.get(l.truckId)
    return (!carrierId || String(l.carrierId) === carrierId)
      && (!dispatcherId || String(l.dispatcherId) === dispatcherId)
      && (!needle || [l.broker, l.pro, l.origin, l.destination, carrierById.get(l.carrierId ?? -1)?.name ?? '', t?.unit ?? '', t?.driver ?? '']
        .some((s) => s.toLowerCase().includes(needle)))
  }
  // Everything except the status tab, so the tab counts match the other filters.
  const base = state.loads.filter((l) => inRange(l, r.cur) && filtersOk(l))
  const prevGross = r.prev ? state.loads.filter((l) => inRange(l, r.prev) && filtersOk(l)).reduce((s, l) => s + gross(l), 0) : null
  const counts = new Map<string, number>()
  for (const l of base) counts.set(l.status, (counts.get(l.status) ?? 0) + 1)
  const overdueCount = base.filter((l) => overdueDays(l) > 0).length

  const loadRpm = (l: Load) => rpm(gross(l), l.loadedMiles)
  const key = (l: Load): string | number =>
    sort.key === 'date' ? l.date + String(l.id).padStart(10, '0')
      : sort.key === 'rate' ? gross(l)
        : sort.key === 'miles' ? l.loadedMiles
          : sort.key === 'rpm' ? (loadRpm(l) ?? -1)
            : sort.key === 'carrier' ? (carrierById.get(l.carrierId ?? -1)?.name ?? '').toLowerCase()
              : sort.key === 'dispatcher' ? (dispatcherName.get(l.dispatcherId ?? -1) ?? '').toLowerCase()
                : sort.key === 'status' ? STATUSES.findIndex((s) => s.id === l.status)
                  : l.broker.toLowerCase()
  const rows = (tab === 'all' ? base : tab === 'overdue' ? base.filter((l) => overdueDays(l) > 0) : base.filter((l) => l.status === tab))
    .sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * (sort.desc ? -1 : 1) })

  const weeks = new Map<string, { gross: number; count: number; miles: number; milesGross: number; pay: Map<number, number> }>()
  for (const l of rows) {
    const w = weekStart(l.date)
    const e = weeks.get(w) ?? { gross: 0, count: 0, miles: 0, milesGross: 0, pay: new Map() }
    e.gross += gross(l)
    e.count++
    e.miles += l.loadedMiles
    if (l.loadedMiles > 0) e.milesGross += gross(l)
    if (l.dispatcherId != null) e.pay.set(l.dispatcherId, (e.pay.get(l.dispatcherId) ?? 0) + pay(l))
    weeks.set(w, e)
  }

  const total = rows.reduce((s, l) => s + gross(l), 0)
  const loaded = rows.reduce((s, l) => s + l.loadedMiles, 0)
  const empty = rows.reduce((s, l) => s + l.emptyMiles, 0)
  // Average RPM only over loads that have miles, so a load without miles doesn't drag it down.
  const withMiles = rows.filter((l) => l.loadedMiles > 0)
  const milesGross = withMiles.reduce((s, l) => s + gross(l), 0)
  const avgRpm = rpm(milesGross, withMiles.reduce((s, l) => s + l.loadedMiles, 0))
  const allInRpm = rpm(milesGross, withMiles.reduce((s, l) => s + l.loadedMiles + l.emptyMiles, 0))
  const totalPay = rows.reduce((s, l) => s + pay(l), 0)
  // Dispatch fees: each carrier's fee for each week (percent of that week's gross, or the flat weekly amount).
  const feeGroups = new Map<string, Load[]>()
  for (const l of rows) {
    if (l.carrierId == null) continue
    const k = `${l.carrierId}|${weekStart(l.date)}`
    feeGroups.set(k, [...(feeGroups.get(k) ?? []), l])
  }
  const fees = [...feeGroups].reduce((s, [k, ls]) => s + carrierFee(carrierById.get(Number(k.split('|')[0])), ls), 0)
  const unpaid = rows.filter((l) => l.status !== 'paid')
  const overdue = rows.filter((l) => overdueDays(l) > 0)
  const delta = prevGross ? Math.round(((total - prevGross) / prevGross) * 100) : null
  const thisWeek = weekStart(today())

  const visibleIds = rows.map((l) => l.id)
  const chosen = rows.filter((l) => selected.has(l.id))
  const allChosen = rows.length > 0 && chosen.length === rows.length
  const toggle = (id: number) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  // Changes show at once; a failed save is reported by the page and the data reloads, so nothing to do here.
  const quiet = (p: Promise<unknown>) => { p.catch(() => undefined) }
  const save = (l: Load, patch: Partial<LoadInput>) => quiet(updateLoad(l.id, { ...l, ...patch }))
  // A new lane needs new miles: they are calculated again automatically.
  const saveLane = (l: Load, patch: Partial<LoadInput>) => save(l, { ...patch, loadedMiles: 0 })
  const sortBy = (k: SortKey) => setSort((s) => ({ key: k, desc: s.key === k ? !s.desc : ['date', 'rate', 'miles', 'rpm'].includes(k) }))
  const th = (k: SortKey, label: string, cls = '') => (
    <th className={cls}>
      <button type="button" className={`th-sort ${sort.key === k ? 'on' : ''}`} onClick={() => sortBy(k)}>
        {label}<span className="arrow">{sort.key === k ? (sort.desc ? '↓' : '↑') : ''}</span>
      </button>
    </th>
  )

  const exportXlsx = () => {
    const data = rows.map((l) => {
      const v = loadRpm(l)
      return [
        l.date, carrierById.get(l.carrierId ?? -1)?.name ?? '', truckLabel(l.truckId), l.broker, l.pro, place(l.origin), place(l.destination),
        l.loadedMiles || '', l.emptyMiles || '', l.rate, extras(l) || '', gross(l), l.lumper || '', v == null ? '' : Math.round(v * 100) / 100,
        dispatcherName.get(l.dispatcherId ?? -1) ?? '', Math.round(pay(l) * 100) / 100, statusLabel(l.status), l.invoicedOn ?? '', l.paidOn ?? '',
      ]
    })
    saveFile(buildXlsx('Loads', [
      'Date', 'Carrier', 'Truck', 'Broker', 'PRO#', 'Origin', 'Destination', 'Loaded miles', 'Empty miles', 'Rate', 'Accessorials', 'Gross',
      'Lumper', 'RPM', 'Dispatcher', 'Dispatcher pay', 'Status', 'Invoiced', 'Paid',
    ], data), `loads_${today()}.xlsx`)
  }

  const truckOptions = (l: Load): [string, string][] => [
    ['', '—'],
    ...trucks.filter((t) => l.carrierId == null || t.carrierId === l.carrierId || t.id === l.truckId)
      .map((t): [string, string] => [String(t.id), t.unit ? `#${t.unit}` : t.driver]),
  ]

  const COLS = 13

  return (
    <div className="lt">
      <div className="lt-top">
        <div className="lt-status" role="tablist" aria-label="Status">
          <button className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>All <span>{base.length}</span></button>
          {STATUSES.map((s) => (
            <button key={s.id} className={tab === s.id ? 'on' : ''} onClick={() => setTab(s.id)}>
              <i className={`dot st-${s.id}`} />{s.label} <span>{counts.get(s.id) ?? 0}</span>
            </button>
          ))}
          {overdueCount > 0 && (
            <button className={`overdue-tab ${tab === 'overdue' ? 'on' : ''}`} onClick={() => setTab('overdue')} title="Invoiced more than 30 days ago and not paid">
              Overdue <span>{overdueCount}</span>
            </button>
          )}
        </div>
        <div className="lt-actions">
          <button className="ghost" onClick={() => setImporting(true)}><Icon name="database" size={14} />Import</button>
          <button className="ghost" onClick={exportXlsx} disabled={!rows.length}><Icon name="download" size={14} />Export</button>
          <button className="primary" onClick={() => setAdding(true)} title="New load (N)">+ New load</button>
        </div>
      </div>

      <div className="lt-filters">
        <label className="lt-search"><Icon name="search" size={14} /><input placeholder="Search broker, PRO#, city, truck…" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <select value={carrierId} onChange={(e) => setCarrierId(e.target.value)} aria-label="Carrier">
          <option value="">All carriers</option>
          {carriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={dispatcherId} onChange={(e) => setDispatcherId(e.target.value)} aria-label="Dispatcher">
          <option value="">All dispatchers</option>
          {dispatchers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <div className="lt-period" role="radiogroup" aria-label="Period">
          {PERIODS.map(([id, label]) => (
            <button key={id} role="radio" aria-checked={period === id} className={period === id ? 'on' : ''} onClick={() => setPeriod(id)}>{label}</button>
          ))}
        </div>
      </div>

      <div className="lt-kpis five">
        <div>
          <span>Gross</span><b>{usd(total)}</b>
          {delta != null && <small className={delta >= 0 ? 'up' : 'down'}>{delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}% {r.label}</small>}
          {delta == null && <small>{rows.length} {rows.length === 1 ? 'load' : 'loads'} · avg {usd(rows.length ? Math.round(total / rows.length) : 0)}</small>}
        </div>
        <div>
          <span>Rate per mile</span><b>{fmtRpm(avgRpm)}</b>
          <small>{fmtMiles(loaded)} loaded mi{empty ? ` · all-in ${fmtRpm(allInRpm)}` : ''}</small>
        </div>
        <div><span>Dispatch fees</span><b>{usd(Math.round(fees))}</b><small>owed by carriers · see Statements</small></div>
        <div><span>Dispatcher pay</span><b>{usd(Math.round(totalPay))}</b><small>by each dispatcher’s %</small></div>
        <div>
          <span>Not paid yet</span><b>{usd(unpaid.reduce((s, l) => s + gross(l), 0))}</b>
          {overdue.length > 0
            ? <small className="down">{overdue.length} overdue · {usd(overdue.reduce((s, l) => s + gross(l), 0))}</small>
            : <small>{unpaid.length} {unpaid.length === 1 ? 'load' : 'loads'} not marked paid</small>}
        </div>
      </div>

      <div className="lt-scroll">
        <table className="lt-table loads">
          <colgroup>
            <col style={{ width: 44 }} /><col style={{ width: 74 }} /><col style={{ width: '9%' }} /><col style={{ width: '5%' }} />
            <col style={{ width: '12.5%' }} /><col style={{ width: '7.5%' }} /><col /><col style={{ width: '5.5%' }} /><col style={{ width: '8%' }} />
            <col style={{ width: '5.5%' }} /><col style={{ width: '7.5%' }} /><col style={{ width: '10%' }} /><col style={{ width: 40 }} />
          </colgroup>
          <thead>
            <tr>
              <th className="c-check">
                <input type="checkbox" aria-label="Select all" checked={allChosen}
                  onChange={() => setSelected(allChosen ? new Set() : new Set(visibleIds))} />
              </th>
              {th('date', 'Date', 'c-date')}
              {th('carrier', 'Carrier', 'c-carrier')}
              <th className="c-truck">Truck</th>
              {th('broker', 'Broker', 'c-broker')}
              <th className="c-pro">PRO#</th>
              <th className="c-lane">Lane</th>
              {th('miles', 'Miles', 'c-num')}
              {th('rate', 'Rate', 'c-rate')}
              {th('rpm', 'RPM', 'c-num')}
              {th('dispatcher', 'Dispatcher', 'c-disp')}
              {th('status', 'Status', 'c-status')}
              <th />
            </tr>
          </thead>
          <tbody>
            {adding && <QuickAdd state={state} carrierId={carrierId} dispatcherId={dispatcherId} onAdd={addLoad} onClose={() => setAdding(false)} />}
            {!rows.length && (
              <tr className="lt-empty"><td colSpan={COLS}>
                {state.loads.length ? 'No loads match these filters.' : (
                  <>
                    <b>No loads yet.</b> Press <kbd>N</kbd> to add one, or bring your spreadsheet in.
                    <button className="primary" onClick={() => setImporting(true)}><Icon name="database" size={14} />Import from Google Sheets</button>
                  </>
                )}
              </td></tr>
            )}
            {rows.map((l, i) => {
              const w = weekStart(l.date)
              const newWeek = sort.key === 'date' && (i === 0 || weekStart(rows[i - 1].date) !== w)
              const sub = weeks.get(w)
              const late = overdueDays(l)
              const add = extras(l)
              return (
                <Fragment key={l.id}>
                  {newWeek && sub && (
                    <tr className={`lt-week ${w === thisWeek ? 'current' : ''}`}>
                      <td className="c-check" />
                      <td colSpan={6}>
                        <div className="wk">
                          <b>{w === thisWeek ? 'This week · ' : 'Week of '}{shortDate(w)} – {shortDate(addDays(w, 6))}</b>
                          <span>{sub.count} {sub.count === 1 ? 'load' : 'loads'}</span>
                          {[...sub.pay].map(([id, p]) => <span key={id} className="wk-pay">{dispatcherName.get(id)} {usd(Math.round(p))}</span>)}
                          <em>Weekly gross</em>
                        </div>
                      </td>
                      <td className="c-num wk-num">{fmtMiles(sub.miles)}</td>
                      <td className="c-rate wk-gross">{usd(sub.gross)}</td>
                      <td className="c-num wk-num">{fmtRpm(rpm(sub.milesGross, sub.miles))}</td>
                      <td colSpan={3} />
                    </tr>
                  )}
                  <tr className={`lt-row ${selected.has(l.id) ? 'sel' : ''}`} onDoubleClick={(e) => { if ((e.target as HTMLElement).tagName === 'TD') openLoad(l.id) }}>
                    <td className="c-check"><input type="checkbox" aria-label="Select load" checked={selected.has(l.id)} onChange={() => toggle(l.id)} /></td>
                    <td className="c-date"><EditText type="date" value={l.date} display={shortDate(l.date)} onSave={(v) => v && save(l, { date: v })} /></td>
                    <td className="c-carrier">
                      <EditSelect value={String(l.carrierId ?? '')} label="Carrier"
                        onSave={(v) => {
                          const id = v ? Number(v) : null
                          const truck = l.truckId == null ? null : truckById.get(l.truckId)
                          save(l, { carrierId: id, truckId: truck && truck.carrierId !== id ? null : l.truckId })
                        }}
                        options={[['', '—'], ...carriers.map((c): [string, string] => [String(c.id), c.name])]} />
                    </td>
                    <td className="c-truck">
                      <EditSelect value={String(l.truckId ?? '')} label="Truck" options={truckOptions(l)}
                        onSave={(v) => {
                          const t = v ? truckById.get(Number(v)) : null
                          save(l, { truckId: t ? t.id : null, carrierId: t?.carrierId ?? l.carrierId })
                        }} />
                    </td>
                    <td className="c-broker"><EditText value={l.broker} onSave={(v) => save(l, { broker: v })} /></td>
                    <td className="c-pro"><EditText value={l.pro} onSave={(v) => save(l, { pro: v })} /></td>
                    <td className="c-lane">
                      <div className="lane">
                        <EditText value={l.origin} display={place(l.origin) || undefined} onSave={(v) => saveLane(l, { origin: v })} />
                        <span className="lane-arrow">→</span>
                        <EditText value={l.destination} display={place(l.destination) || undefined} onSave={(v) => saveLane(l, { destination: v })} />
                      </div>
                    </td>
                    <td className="c-num">
                      <EditText align="right" value={l.loadedMiles ? String(l.loadedMiles) : ''} display={l.loadedMiles ? fmtMiles(l.loadedMiles) : undefined}
                        onSave={(v) => save(l, { loadedMiles: whole(v) })} />
                    </td>
                    <td className="c-rate">
                      <EditText align="right" value={String(l.rate)}
                        display={add ? <span title={`Rate ${usd(l.rate)} + accessorials ${usd(add)}`}>{usd(gross(l))}<i className="plus">+</i></span> : usd(l.rate)}
                        onSave={(v) => save(l, { rate: money(v) })} />
                    </td>
                    <td className="c-num rpm">{fmtRpm(loadRpm(l))}</td>
                    <td className="c-disp">
                      <EditSelect value={String(l.dispatcherId ?? '')} label="Dispatcher" onSave={(v) => save(l, { dispatcherId: v ? Number(v) : null })}
                        options={[['', '—'], ...dispatchers.map((d): [string, string] => [String(d.id), d.name])]} />
                    </td>
                    <td className="c-status">
                      <span className={`st-dot st-${l.status}`}>
                        <EditSelect value={l.status} label="Status" onSave={(v) => save(l, withStatusDates(l, v as LoadStatus))}
                          options={STATUSES.map((s): [string, string] => [s.id, s.label])} />
                        {late > 0 && <em className="late" title={`Invoiced ${shortDate(l.invoicedOn!)} — ${late} days past 30-day terms`}>{late}d late</em>}
                      </span>
                    </td>
                    <td className="c-open">
                      <button className="open-btn" title="Open load: miles, accessorials, invoice and payment" aria-label="Open load" onClick={() => openLoad(l.id)}>
                        <Icon name="arrow" size={14} />
                      </button>
                    </td>
                  </tr>
                </Fragment>
              )
            })}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr>
                <td className="c-check" />
                <td colSpan={6}>
                  <div className="wk">
                    <b>{rows.length} {rows.length === 1 ? 'load' : 'loads'}</b>
                    {dispatchers.length > 0 && <span>Dispatcher pay {usd(Math.round(totalPay))}</span>}
                    <em>Total gross</em>
                  </div>
                </td>
                <td className="c-num wk-num">{fmtMiles(loaded)}</td>
                <td className="c-rate wk-gross">{usd(total)}</td>
                <td className="c-num wk-num">{fmtRpm(avgRpm)}</td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {chosen.length > 0 && (
        <div className="lt-bulk" role="toolbar" aria-label="Selected loads">
          <b>{chosen.length} selected</b>
          <span className="sum">{usd(chosen.reduce((s, l) => s + gross(l), 0))}</span>
          <span className="sep" />
          <span className="lbl">Mark as</span>
          {STATUSES.map((s) => (
            <button key={s.id} onClick={() => { quiet(updateMany(chosen, (l) => withStatusDates(l, s.id))); setSelected(new Set()) }}>
              <i className={`dot st-${s.id}`} />{s.label}
            </button>
          ))}
          <span className="sep" />
          <button className="danger" onClick={() => { if (confirm(`Delete ${chosen.length} loads?`)) { quiet(removeMany(chosen.map((l) => l.id))); setSelected(new Set()) } }}>Delete</button>
          <button className="close" aria-label="Clear selection" onClick={() => setSelected(new Set())}>×</button>
        </div>
      )}

      {importing && (
        <ImportDialog carriers={carriers} onClose={() => setImporting(false)}
          onImport={async (rows2) => { await importLoads(rows2); setImporting(false) }} />
      )}
    </div>
  )
}

/** New-load row: Tab between fields, Enter adds and keeps the row open for the next load, Esc closes. */
function QuickAdd({ state, carrierId, dispatcherId, onAdd, onClose }: {
  state: CrmState; carrierId: string; dispatcherId: string; onAdd: (l: LoadInput) => Promise<unknown>; onClose: () => void
}) {
  const blank = () => ({
    date: today(), carrierId: carrierId || (state.carriers.length === 1 ? String(state.carriers[0].id) : ''), truckId: '',
    dispatcherId: dispatcherId || (state.dispatchers.length === 1 ? String(state.dispatchers[0].id) : ''),
    broker: '', pro: '', origin: '', destination: '', miles: '', rate: '',
  })
  const [v, setV] = useState(blank)
  const first = useRef<HTMLInputElement>(null)
  const set = (k: keyof typeof v, value: string) => setV((x) => ({ ...x, [k]: value }))
  useEffect(() => { first.current?.focus() }, [])
  const trucks = state.trucks.filter((t) => !v.carrierId || String(t.carrierId) === v.carrierId)

  /** The row appears in the table at once and the form is ready for the next load; on failure the typed values come back. */
  const submit = () => {
    if (!v.date || !(v.broker || v.rate)) return
    const typed = v
    onAdd({
      ...LOAD_EXTRAS,
      date: v.date, carrierId: v.carrierId ? Number(v.carrierId) : null, dispatcherId: v.dispatcherId ? Number(v.dispatcherId) : null,
      truckId: v.truckId ? Number(v.truckId) : null, loadedMiles: whole(v.miles),
      broker: v.broker, pro: v.pro, origin: v.origin, destination: v.destination, rate: money(v.rate), notes: '', status: 'booked',
    }).catch(() => setV(typed))
    setV((x) => ({ ...blank(), date: x.date, carrierId: x.carrierId, truckId: x.truckId, dispatcherId: x.dispatcherId }))
    first.current?.focus()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); submit() }
    if (e.key === 'Escape') onClose()
  }

  return (
    <tr className="lt-add" onKeyDown={onKey}>
      <td className="c-check"><button className="add-x" aria-label="Close new load" onClick={onClose}>×</button></td>
      <td className="c-date"><input type="date" value={v.date} onChange={(e) => set('date', e.target.value)} aria-label="Date" /></td>
      <td className="c-carrier">
        <select value={v.carrierId} onChange={(e) => setV((x) => ({ ...x, carrierId: e.target.value, truckId: '' }))} aria-label="Carrier">
          <option value="">Carrier</option>
          {state.carriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </td>
      <td className="c-truck">
        <select value={v.truckId} onChange={(e) => set('truckId', e.target.value)} aria-label="Truck">
          <option value="">#</option>
          {trucks.map((t) => <option key={t.id} value={t.id}>{t.unit ? `#${t.unit}` : t.driver}</option>)}
        </select>
      </td>
      <td className="c-broker"><input ref={first} placeholder="Broker" value={v.broker} onChange={(e) => set('broker', e.target.value)} aria-label="Broker" /></td>
      <td className="c-pro"><input placeholder="PRO#" value={v.pro} onChange={(e) => set('pro', e.target.value)} aria-label="PRO number" /></td>
      <td className="c-lane">
        <div className="lane">
          <input placeholder="Origin" value={v.origin} onChange={(e) => set('origin', e.target.value)} aria-label="Origin" />
          <span className="lane-arrow">→</span>
          <input placeholder="Destination" value={v.destination} onChange={(e) => set('destination', e.target.value)} aria-label="Destination" />
        </div>
      </td>
      <td className="c-num"><input className="right" inputMode="numeric" placeholder="auto" title="Leave empty: miles are calculated from the lane" value={v.miles} onChange={(e) => set('miles', e.target.value)} aria-label="Loaded miles" /></td>
      <td className="c-rate"><input className="right" inputMode="decimal" placeholder="$0" value={v.rate} onChange={(e) => set('rate', e.target.value)} aria-label="Rate" /></td>
      <td className="c-num" />
      <td className="c-disp">
        <select value={v.dispatcherId} onChange={(e) => set('dispatcherId', e.target.value)} aria-label="Dispatcher">
          <option value="">Dispatcher</option>
          {state.dispatchers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </td>
      <td className="c-status" colSpan={2}>
        <button className="primary lt-add-btn" disabled={!(v.broker || v.rate)} onClick={submit}>Add <kbd>↵</kbd></button>
      </td>
    </tr>
  )
}
