import { Fragment, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import { saveFile } from '../../lib/export'
import {
  addDays, carrierFee, extras, fmtMiles, fmtRpm, gross, overdueDays, rpm, shortDate, STATUSES, today, usd, weekStart,
  withStatusDates, type CrmState, type ImportRow, type Load, type LoadInput, type LoadStatus,
} from '../../lib/crm'
import { buildXlsx } from '../../lib/xlsx'
import { Icon } from '../Icon'
import { ImportDialog } from './ImportDialog'
import { KpiDrawer, type KpiKind } from './KpiDrawer'

type Period = 'week' | 'last' | 'month' | 'all'
type SortKey = 'date' | 'carrier' | 'broker' | 'rate' | 'miles' | 'rpm' | 'dispatcher' | 'status'
type Tab = LoadStatus | 'all' | 'overdue'

const PERIODS: [Period, string][] = [['week', 'This week'], ['last', 'Last week'], ['month', 'This month'], ['all', 'All time']]
const statusLabel = (s: LoadStatus) => STATUSES.find((x) => x.id === s)?.label ?? s
const weekday = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })

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
  updateLoad: (id: number, l: LoadInput) => Promise<unknown>
  /** Applies a change to several loads; the change can depend on each load (e.g. keep its own invoice date). */
  updateMany: (loads: Load[], patch: (l: Load) => Partial<LoadInput>) => Promise<unknown>
  removeMany: (ids: number[]) => Promise<unknown>
  importLoads: (rows: ImportRow[]) => Promise<unknown>
  openLoad: (id: number) => void
  /** Opens the new-load form; the current carrier/dispatcher filters become its defaults. */
  newLoad: (defaults: { carrierId: string; dispatcherId: string }) => void
  /** Opens another section of the board (KPI details and the getting-started steps link there). */
  goTab: (tab: 'statements' | 'carriers' | 'trucks' | 'dispatchers') => void
}

/**
 * The load board, laid out like the load lists of common TMSs: one row per load with two-line cells
 * (broker over load #, lane over miles, carrier over truck/driver, rate over RPM), status changed right in the row,
 * everything else in the load panel that opens on a click. Weekly subtotals, KPIs, bulk actions.
 */
export function LoadsTable({ state, updateLoad, updateMany, removeMany, importLoads, openLoad, newLoad, goTab }: Props) {
  const { carriers, dispatchers, trucks } = state
  const [tab, setTab] = useState<Tab>('all')
  const [period, setPeriod] = useState<Period>('all')
  const [carrierId, setCarrierId] = useState('')
  const [dispatcherId, setDispatcherId] = useState('')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'date', desc: true })
  const [importing, setImporting] = useState(false)
  const [kpi, setKpi] = useState<KpiKind | null>(null)
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
  const add = () => newLoad({ carrierId, dispatcherId })

  // "N" opens the new-load form, unless you are typing somewhere or a panel is open.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.key.toLowerCase() === 'n' && !e.metaKey && !e.ctrlKey && !e.altKey && !/INPUT|SELECT|TEXTAREA/.test(t.tagName)
        && !document.querySelector('.ld-backdrop')) {
        e.preventDefault()
        newLoad({ carrierId, dispatcherId })
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [newLoad, carrierId, dispatcherId])

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
  const sortBy = (k: SortKey) => setSort((s) => ({ key: k, desc: s.key === k ? !s.desc : ['date', 'rate', 'miles', 'rpm'].includes(k) }))
  const sortBtn = (k: SortKey, label: string) => (
    <button type="button" className={`th-sort ${sort.key === k ? 'on' : ''}`} onClick={() => sortBy(k)}>
      {label}<span className="arrow">{sort.key === k ? (sort.desc ? '↓' : '↑') : ''}</span>
    </button>
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

  /** A click anywhere on a row opens the load, except on its checkbox and in-row menus. */
  const onRowClick = (e: MouseEvent, id: number) => {
    if ((e.target as HTMLElement).closest('input, select, button, a, label')) return
    if (getSelection()?.toString()) return
    openLoad(id)
  }

  const COLS = 8

  /** Subtotal row (a week, or everything shown): each number sits in its own column, two lines like the loads. */
  const sumRow = (cls: string, label: string, t: { count: number; miles: number; milesGross: number; gross: number; pay: Map<number, number> }) => {
    const payTotal = [...t.pay.values()].reduce((a, b) => a + b, 0)
    const payBy = [...t.pay].sort((a, b) => b[1] - a[1]).map(([id, p]) => `${dispatcherName.get(id) ?? '—'} ${usd(Math.round(p))}`).join(' · ')
    return (
      <tr className={cls}>
        <td className="lb-check" />
        <td colSpan={2}><b>{label}</b><small>{t.count} {t.count === 1 ? 'load' : 'loads'}</small></td>
        <td><b>{t.miles ? `${fmtMiles(t.miles)} mi` : ''}</b><small>{t.miles ? 'loaded' : ''}</small></td>
        <td />
        <td className="lb-num lb-rate"><b className="wk-gross">{usd(t.gross)}</b><small>{t.miles ? `${fmtRpm(rpm(t.milesGross, t.miles))}/mi` : ''}</small></td>
        <td className="lb-disp" title={payBy ? `Dispatcher pay: ${payBy}` : undefined}>
          {payTotal > 0 && <><b>{usd(Math.round(payTotal))}</b><small>dispatcher pay</small></>}
        </td>
        <td />
      </tr>
    )
  }

  // A brand-new board: a short setup guide instead of empty KPIs and an empty table.
  if (!state.loads.length) {
    return (
      <>
        <GettingStarted state={state} add={add} importFile={() => setImporting(true)} goTab={goTab} />
        {importing && (
          <ImportDialog carriers={carriers} onClose={() => setImporting(false)}
            onImport={async (rows2) => { await importLoads(rows2); setImporting(false) }} />
        )}
      </>
    )
  }

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
          <button className="primary" onClick={add} title="New load (N)">+ New load</button>
        </div>
      </div>

      <div className="lt-filters">
        <label className="lt-search"><Icon name="search" size={14} /><input placeholder="Search broker, load #, city, truck, driver…" value={q} onChange={(e) => setQ(e.target.value)} /></label>
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

      <div className="lt-kpis five kpi-click">
        <button type="button" onClick={() => setKpi('gross')}>
          <span>Gross<Icon name="chevron" size={13} /></span><b>{usd(total)}</b>
          {delta != null && <small className={delta >= 0 ? 'up' : 'down'}>{delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}% {r.label}</small>}
          {delta == null && <small>{rows.length} {rows.length === 1 ? 'load' : 'loads'} · avg {usd(rows.length ? Math.round(total / rows.length) : 0)}</small>}
        </button>
        <button type="button" onClick={() => setKpi('rpm')}>
          <span>Rate per mile<Icon name="chevron" size={13} /></span><b>{fmtRpm(avgRpm)}</b>
          <small>{fmtMiles(loaded)} loaded mi{empty ? ` · all-in ${fmtRpm(allInRpm)}` : ''}</small>
        </button>
        <button type="button" onClick={() => setKpi('fees')}>
          <span>Dispatch fees<Icon name="chevron" size={13} /></span><b>{usd(Math.round(fees))}</b><small>owed by carriers</small>
        </button>
        <button type="button" onClick={() => setKpi('pay')}>
          <span>Dispatcher pay<Icon name="chevron" size={13} /></span><b>{usd(Math.round(totalPay))}</b><small>by each dispatcher’s %</small>
        </button>
        <button type="button" onClick={() => setKpi('unpaid')}>
          <span>Not paid yet<Icon name="chevron" size={13} /></span><b>{usd(unpaid.reduce((s, l) => s + gross(l), 0))}</b>
          {overdue.length > 0
            ? <small className="down">{overdue.length} overdue · {usd(overdue.reduce((s, l) => s + gross(l), 0))}</small>
            : <small>{unpaid.length} {unpaid.length === 1 ? 'load' : 'loads'} not marked paid</small>}
        </button>
      </div>

      <div className="lt-scroll">
        <table className="lb">
          <colgroup>
            <col className="lb-w-check" /><col className="lb-w-date" /><col className="lb-w-load" /><col className="lb-w-lane" />
            <col className="lb-w-carrier" /><col className="lb-w-rate" /><col className="lb-w-disp" /><col className="lb-w-status" />
          </colgroup>
          <thead>
            <tr>
              <th className="lb-check">
                <input type="checkbox" aria-label="Select all" checked={allChosen}
                  onChange={() => setSelected(allChosen ? new Set() : new Set(visibleIds))} />
              </th>
              <th>{sortBtn('date', 'Pickup')}</th>
              <th>{sortBtn('broker', 'Broker · load #')}</th>
              <th>{sortBtn('miles', 'Lane · miles')}</th>
              <th>{sortBtn('carrier', 'Carrier · truck')}</th>
              <th className="lb-num">{sortBtn('rate', 'Rate')}{sortBtn('rpm', 'RPM')}</th>
              <th className="lb-disp">{sortBtn('dispatcher', 'Dispatcher')}</th>
              <th>{sortBtn('status', 'Status')}</th>
            </tr>
          </thead>
          <tbody>
            {!rows.length && (
              <tr className="lt-empty"><td colSpan={COLS}>
                <div className="lb-none"><b>No loads match these filters</b><span>Try another period, status or search.</span></div>
              </td></tr>
            )}
            {rows.map((l, i) => {
              const w = weekStart(l.date)
              const newWeek = sort.key === 'date' && (i === 0 || weekStart(rows[i - 1].date) !== w)
              const sub = weeks.get(w)
              const late = overdueDays(l)
              const acc = extras(l)
              const carrier = l.carrierId == null ? undefined : carrierById.get(l.carrierId)
              const truck = l.truckId == null ? undefined : truckById.get(l.truckId)
              const v = loadRpm(l)
              return (
                <Fragment key={l.id}>
                  {newWeek && sub && (
                    sumRow(`lb-sum ${w === thisWeek ? 'current' : ''}`,
                      `${w === thisWeek ? 'This week · ' : 'Week of '}${shortDate(w)} – ${shortDate(addDays(w, 6))}`, sub)
                  )}
                  <tr className={`lb-row ${selected.has(l.id) ? 'sel' : ''}`} onClick={(e) => onRowClick(e, l.id)}>
                    <td className="lb-check"><input type="checkbox" aria-label="Select load" checked={selected.has(l.id)} onChange={() => toggle(l.id)} /></td>
                    <td className="lb-date"><b>{shortDate(l.date)}</b><small>{weekday(l.date)}</small></td>
                    <td className="lb-load">
                      <b title={l.broker}>{l.broker || <em>No broker</em>}</b>
                      <small>{l.pro ? `# ${l.pro}` : <em>no load #</em>}</small>
                    </td>
                    <td className="lb-lane">
                      <div className="lb-route" title={`${place(l.origin)} → ${place(l.destination)}`}>
                        <span>{place(l.origin) || <em>Origin</em>}</span><i>→</i><span>{place(l.destination) || <em>Destination</em>}</span>
                      </div>
                      <small>
                        {l.loadedMiles ? `${fmtMiles(l.loadedMiles)} mi` : l.origin && l.destination ? 'miles…' : ''}
                        {l.emptyMiles > 0 && ` · ${fmtMiles(l.emptyMiles)} empty`}
                      </small>
                    </td>
                    <td className="lb-carrier">
                      <b title={carrier?.name}>{carrier?.name ?? <em>No carrier</em>}</b>
                      <small>{truck ? [truck.unit && `#${truck.unit}`, truck.driver].filter(Boolean).join(' · ') : ''}</small>
                    </td>
                    <td className="lb-num lb-rate">
                      <b title={acc ? `Rate ${usd(l.rate)} + accessorials ${usd(acc)}` : undefined}>{usd(gross(l))}{acc > 0 && <i className="plus">+</i>}</b>
                      <small>{v == null ? '' : `${fmtRpm(v)}/mi`}</small>
                    </td>
                    <td className="lb-disp">
                      <EditSelect value={String(l.dispatcherId ?? '')} label="Dispatcher" onSave={(x) => save(l, { dispatcherId: x ? Number(x) : null })}
                        options={[['', '—'], ...dispatchers.map((d): [string, string] => [String(d.id), d.name])]} />
                    </td>
                    <td className="lb-status">
                      <label className={`pill st-${l.status}`}>
                        <select value={l.status} aria-label="Status" onChange={(e) => save(l, withStatusDates(l, e.target.value as LoadStatus))}>
                          {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                        </select>
                      </label>
                      {late > 0 && <small className="late" title={`Invoiced ${shortDate(l.invoicedOn!)} — ${late} days past 30-day terms`}>{late} days late</small>}
                    </td>
                  </tr>
                </Fragment>
              )
            })}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              {sumRow('lb-sum total', period === 'all' ? 'All loads' : PERIODS.find(([id]) => id === period)![1], {
                count: rows.length, miles: loaded, milesGross, gross: total,
                pay: new Map([...weeks.values()].flatMap((x) => [...x.pay]).reduce((m, [id, p]) => m.set(id, (m.get(id) ?? 0) + p), new Map<number, number>())),
              })}
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

      {kpi && (
        <KpiDrawer kind={kpi} rows={rows} state={state} close={() => setKpi(null)} openLoad={openLoad}
          periodLabel={`${PERIODS.find(([id]) => id === period)![1]}${carrierId ? ` · ${carrierById.get(Number(carrierId))?.name ?? ''}` : ''}${dispatcherId ? ` · ${dispatcherName.get(Number(dispatcherId)) ?? ''}` : ''}`}
          markPaid={(ls) => quiet(updateMany(ls, (l) => withStatusDates(l, 'paid')))}
          goStatements={() => goTab('statements')} />
      )}

      {importing && (
        <ImportDialog carriers={carriers} onClose={() => setImporting(false)}
          onImport={async (rows2) => { await importLoads(rows2); setImporting(false) }} />
      )}
    </div>
  )
}

/** First steps for a new account, the way TMS onboarding checklists look: carriers, trucks, first loads. */
function GettingStarted({ state, add, importFile, goTab }: {
  state: CrmState; add: () => void; importFile: () => void; goTab: Props['goTab']
}) {
  const steps: { done: boolean; title: string; text: string; action: ReactNode }[] = [
    {
      done: state.carriers.length > 0, title: 'Add your carriers',
      text: 'Type an MC number — the name, USDOT and phone fill in from FMCSA. Set each carrier’s dispatch fee.',
      action: <button className={state.carriers.length ? 'ghost' : 'primary'} onClick={() => goTab('carriers')}>{state.carriers.length ? `${state.carriers.length} added · Manage` : 'Add carriers'}</button>,
    },
    {
      done: state.trucks.length > 0, title: 'Add trucks and drivers',
      text: 'Optional. Loads get a truck, and deadhead is counted from the truck’s last drop.',
      action: <button className="ghost" onClick={() => goTab('trucks')}>{state.trucks.length ? `${state.trucks.length} added · Manage` : 'Add trucks'}</button>,
    },
    {
      done: state.dispatchers.length > 0, title: 'Add your dispatchers',
      text: 'Optional. Each dispatcher’s percent of gross becomes their weekly pay.',
      action: <button className="ghost" onClick={() => goTab('dispatchers')}>{state.dispatchers.length ? `${state.dispatchers.length} added · Manage` : 'Add dispatchers'}</button>,
    },
  ]
  return (
    <div className="gs">
      <div className="gs-head">
        <h2>Welcome to HaulPanel{state.company?.name ? `, ${state.company.name}` : ''}</h2>
        <p>Set up your board in a few minutes. You can change everything later.</p>
      </div>
      <div className="gs-grid">
        <ol className="gs-steps">
          {steps.map((st, i) => (
            <li key={st.title} className={st.done ? 'done' : ''}>
              <span className="gs-num">{st.done ? <Icon name="check" size={14} /> : i + 1}</span>
              <div><b>{st.title}</b><p>{st.text}</p></div>
              {st.action}
            </li>
          ))}
        </ol>
        <div className="gs-loads">
          <span className="gs-icon"><Icon name="file" size={20} /></span>
          <h3>Add your loads</h3>
          <p>Enter loads one by one, or bring your whole history from a spreadsheet.</p>
          <button className="primary" onClick={add}>+ New load</button>
          <button className="ghost" onClick={importFile}><Icon name="download" size={14} />Import Excel, CSV or Google Sheets</button>
          <small>Tip: press <kbd>N</kbd> anywhere on the board to add a load.</small>
        </div>
      </div>
    </div>
  )
}
