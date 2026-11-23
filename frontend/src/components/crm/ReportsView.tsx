import { useMemo, useState } from 'react'
import {
  addDays, carrierFee, daysBetween, fmtRpm, gross, isBroker, margin, overdueDays, PAY_TERMS_DAYS, payBase, rpm, shortDate, STATUSES, today, usd, weekStart, words,
  type CrmState, type Load,
} from '../../lib/crm'
import { buildXlsx, type Cell } from '../../lib/xlsx'
import { saveFile } from '../../lib/export'
import { place } from './LoadsTable'

type Period = 'month' | 'last_month' | '90' | 'year' | 'all'
const PERIODS: [Period, string][] = [['month', 'This month'], ['last_month', 'Last month'], ['90', 'Last 90 days'], ['year', 'This year'], ['all', 'All time']]

function span(p: Period, now = today()): [string, string] | null {
  const [y, m] = now.split('-').map(Number)
  const first = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, '0')}-01`
  if (p === 'month') return [first(y, m), now]
  if (p === 'last_month') { const [ly, lm] = m === 1 ? [y - 1, 12] : [y, m - 1]; return [first(ly, lm), addDays(first(y, m), -1)] }
  if (p === '90') return [addDays(now, -89), now]
  if (p === 'year') return [`${y}-01-01`, now]
  return null
}

const state2 = (s: string) => /,\s*([A-Za-z]{2})\b/.exec(s)?.[1]?.toUpperCase() ?? ''
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—')

interface Row { key: string; label: string; sub?: string; loads: number; gross: number; miles: number; empty: number; extra?: number; extra2?: number }
const add = (m: Map<string, Row>, key: string, label: string, l: Load, sub?: string) => {
  const r = m.get(key) ?? { key, label, sub, loads: 0, gross: 0, miles: 0, empty: 0, extra: 0, extra2: 0 }
  r.loads++; r.gross += gross(l); r.miles += l.loadedMiles; r.empty += l.emptyMiles
  m.set(key, r)
  return r
}
const sorted = (m: Map<string, Row>) => [...m.values()].sort((a, b) => b.gross - a.gross)

/**
 * Reports for the owner: what the company made in a period and where it came from — per dispatcher, carrier,
 * broker (and how fast each pays) and lane — with the loads as an Excel file and invoices for QuickBooks.
 */
export function ReportsView({ state }: { state: CrmState }) {
  const [period, setPeriod] = useState<Period>('month')
  const range = span(period)
  const broker = isBroker(state)
  const w = words(broker)
  const loads = useMemo(() => state.loads.filter((l) => l.id > 0 && (!range || (l.date >= range[0] && l.date <= range[1]))), [state.loads, period]) // eslint-disable-line react-hooks/exhaustive-deps

  const r = useMemo(() => {
    const total = loads.reduce((s, l) => s + gross(l), 0)
    const miles = loads.reduce((s, l) => s + l.loadedMiles, 0)
    const empty = loads.reduce((s, l) => s + l.emptyMiles, 0)
    const percent = new Map(state.dispatchers.map((d) => [d.id, d.percent]))
    const pay = loads.reduce((s, l) => s + (l.dispatcherId != null ? (payBase(l, broker) * (percent.get(l.dispatcherId) ?? 0)) / 100 : 0), 0)
    // Dispatch fees: percent carriers per load, flat carriers once per week they ran.
    let fees = 0
    const byCarrierWeek = new Map<string, Load[]>()
    for (const l of loads) if (l.carrierId != null) {
      const k = `${l.carrierId}|${weekStart(l.date)}`
      byCarrierWeek.set(k, [...(byCarrierWeek.get(k) ?? []), l])
    }
    for (const [k, ls] of byCarrierWeek) fees += carrierFee(state.carriers.find((c) => String(c.id) === k.split('|')[0]), ls)
    const unpaid = state.loads.filter((l) => l.status === 'invoiced')
    const overdue = unpaid.filter((l) => overdueDays(l) > 0)

    const disp = new Map<string, Row>(), carr = new Map<string, Row>(), brok = new Map<string, Row>(), lanes = new Map<string, Row>()
    for (const l of loads) {
      const d = state.dispatchers.find((x) => x.id === l.dispatcherId)
      const dr = add(disp, String(l.dispatcherId ?? 'none'), d?.name ?? `No ${w.dispatcher.toLowerCase()}`, l, d ? `${d.percent}%` : undefined)
      dr.extra! += d ? (payBase(l, broker) * d.percent) / 100 : 0
      const c = state.carriers.find((x) => x.id === l.carrierId)
      add(carr, String(l.carrierId ?? 'none'), c?.name ?? 'No carrier', l, c?.mc ? `MC ${c.mc.replace(/\D/g, '')}` : undefined)
      const b = l.broker.trim() || `No ${w.customerLower}`
      const br = add(brok, b.toLowerCase(), b, l)
      if (l.paidOn && l.invoicedOn) { br.extra! += daysBetween(l.invoicedOn, l.paidOn); br.extra2! += 1 }
      const a = state2(l.origin), z = state2(l.destination)
      if (a && z) add(lanes, `${a}>${z}`, `${a} → ${z}`, l)
    }
    for (const c of carr.values()) {
      const carrier = state.carriers.find((x) => String(x.id) === c.key)
      let f = 0
      for (const [k, ls] of byCarrierWeek) if (k.split('|')[0] === c.key) f += carrierFee(carrier, ls)
      c.extra = broker ? loads.filter((l) => String(l.carrierId ?? 'none') === c.key).reduce((s, l) => s + (l.carrierPay ?? 0), 0) : f
    }
    const withPay = loads.filter((l) => margin(l) != null)
    const marginSum = withPay.reduce((s, l) => s + (margin(l) ?? 0), 0)
    return {
      total, miles, empty, pay, fees, unpaid, overdue, marginSum, withPay: withPay.length, withPayGross: withPay.reduce((s, l) => s + gross(l), 0),
      disp: sorted(disp), carr: sorted(carr), brok: sorted(brok), lanes: sorted(lanes).slice(0, 15),
    }
  }, [loads, state, broker]) // eslint-disable-line react-hooks/exhaustive-deps

  const label = PERIODS.find(([p]) => p === period)![1]
  const name = (what: string) => `haulpanel-${what}-${range ? `${range[0]}_to_${range[1]}` : 'all-time'}`

  const exportLoads = () => {
    const header = ['Pickup date', 'Status', w.customer, `${w.customer} MC`, 'Load #', 'Origin', 'Destination', 'Loaded miles', 'Empty miles', 'Rate', 'Detention',
      'Layover', 'TONU', 'Other', 'Lumper', 'Gross', 'RPM', 'All-in RPM', 'Carrier', 'Truck', 'Driver', w.dispatcher, 'Invoiced on', 'Paid on', 'Notes',
      ...(broker ? ['Carrier pay', 'Margin', 'Carrier paid on'] : [])]
    const rows: Cell[][] = [...loads].sort((a, b) => a.date.localeCompare(b.date)).map((l) => {
      const t = state.trucks.find((x) => x.id === l.truckId)
      const g = gross(l)
      return [l.date, STATUSES.find((s) => s.id === l.status)?.label, l.broker, l.brokerMc ?? '', l.pro, place(l.origin), place(l.destination), l.loadedMiles || null,
        l.emptyMiles || null, l.rate, l.detention || null, l.layover || null, l.tonu || null, l.other || null, l.lumper || null, g,
        l.loadedMiles ? Math.round((g / l.loadedMiles) * 100) / 100 : null, l.loadedMiles ? Math.round((g / (l.loadedMiles + l.emptyMiles)) * 100) / 100 : null,
        state.carriers.find((c) => c.id === l.carrierId)?.name, t?.unit, t?.driver, state.dispatchers.find((d) => d.id === l.dispatcherId)?.name,
        l.invoicedOn, l.paidOn, l.notes, ...(broker ? [l.carrierPay || null, margin(l), l.carrierPaidOn ?? null] : [])]
    })
    saveFile(buildXlsx('Loads', header, rows), `${name('loads')}.xlsx`)
  }

  /** QuickBooks Online invoice import (Sales → Invoices → Import): one line per charge. */
  const exportQuickBooks = () => {
    const header = ['InvoiceNo', 'Customer', 'InvoiceDate', 'DueDate', 'Terms', 'Memo', 'Item(Product/Service)', 'ItemDescription', 'ItemQuantity', 'ItemRate', 'ItemAmount', 'Service Date']
    const us = (iso: string) => { const [y, m, d] = iso.split('-'); return `${m}/${d}/${y}` }
    const rows: string[][] = []
    for (const l of loads.filter((x) => x.invoicedOn)) {
      const no = state.invoices?.find((i) => i.loadId === l.id)?.number ?? `INV-${String(l.id).padStart(5, '0')}`
      const charges: [string, number][] = [['Linehaul', l.rate], ['Detention', l.detention], ['Layover', l.layover], ['TONU', l.tonu], ['Other', l.other], ['Lumper', l.lumper]]
      for (const [item, amount] of charges.filter(([, a]) => a > 0)) {
        rows.push([no, l.broker || 'Broker', us(l.invoicedOn!), us(addDays(l.invoicedOn!, PAY_TERMS_DAYS)), `Net ${PAY_TERMS_DAYS}`, `Load ${l.pro || l.id}`,
          item, `${place(l.origin)} - ${place(l.destination)}`, '1', amount.toFixed(2), amount.toFixed(2), us(l.date)])
      }
    }
    const csv = [header, ...rows].map((r) => r.map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(',')).join('\r\n')
    saveFile(new Blob(['﻿' + csv], { type: 'text/csv' }), `${name('quickbooks-invoices')}.csv`)
  }

  const deadhead = r.miles + r.empty > 0 ? r.empty / (r.miles + r.empty) : 0
  const unpaidSum = r.unpaid.reduce((s, l) => s + gross(l), 0)
  const overdueSum = r.overdue.reduce((s, l) => s + gross(l), 0)
  const max = (rows: Row[]) => Math.max(1, ...rows.map((x) => x.gross))

  return (
    <div className="rp">
      <div className="rp-head">
        <div>
          <h2>Reports</h2>
          <p>{label}{range ? ` · ${shortDate(range[0])} – ${shortDate(range[1])}` : ''} · {loads.length} {loads.length === 1 ? 'load' : 'loads'} by pickup date</p>
        </div>
        <div className="rp-tools">
          <div className="rp-periods" role="group" aria-label="Period">
            {PERIODS.map(([p, t]) => <button key={p} className={p === period ? 'on' : ''} aria-pressed={p === period} onClick={() => setPeriod(p)}>{t}</button>)}
          </div>
          <button onClick={exportLoads} disabled={!loads.length}>Excel</button>
          <button onClick={exportQuickBooks} disabled={!loads.some((l) => l.invoicedOn)} title="Invoices of this period as a QuickBooks Online import file">QuickBooks</button>
        </div>
      </div>

      <div className="rp-kpis">
        <div><span>Gross</span><b>{usd(Math.round(r.total))}</b><small>{loads.length ? `avg ${usd(Math.round(r.total / loads.length))} / load` : 'no loads'}</small></div>
        <div><span>Rate per mile</span><b>{fmtRpm(rpm(r.total, r.miles))}</b><small>all-in {fmtRpm(rpm(r.total, r.miles + r.empty))}</small></div>
        <div><span>Miles</span><b>{r.miles.toLocaleString('en-US')}</b><small>deadhead {r.empty.toLocaleString('en-US')} mi · {Math.round(deadhead * 100)}%</small></div>
        {broker
          ? <div><span>Margin</span><b>{usd(Math.round(r.marginSum))}</b><small>{r.withPayGross ? `${Math.round((r.marginSum / r.withPayGross) * 100)}% · ` : ''}agent pay {usd(Math.round(r.pay))}{r.withPay < loads.length ? ` · ${loads.length - r.withPay} without carrier pay` : ''}</small></div>
          : <div><span>Dispatch fees</span><b>{usd(Math.round(r.fees))}</b><small>dispatcher pay {usd(Math.round(r.pay))}</small></div>}
        <div className={r.overdue.length ? 'bad' : ''}><span>Not paid yet</span><b>{usd(Math.round(unpaidSum))}</b><small>{r.overdue.length ? `${r.overdue.length} overdue · ${usd(Math.round(overdueSum))}` : `${r.unpaid.length} invoiced, none overdue`}</small></div>
      </div>

      {!loads.length ? <p className="bm-empty">No loads in this period. Pick another period above.</p> : (
        <div className="rp-grid">
          <Table title={w.dispatchers} rows={r.disp} max={max(r.disp)} extraHead="Pay" extra={(x) => usd(Math.round(x.extra ?? 0))} />
          <Table title="Carriers" rows={r.carr} max={max(r.carr)} extraHead={broker ? 'Carrier pay' : 'Fee'} extra={(x) => usd(Math.round(x.extra ?? 0))} deadhead />
          <Table title={w.customers} rows={r.brok} max={max(r.brok)} extraHead="Pays in" note="Average days from invoice to payment"
            extra={(x) => (x.extra2 ? `${Math.round(x.extra! / x.extra2)} days` : '—')} />
          <Table title="Lanes (state to state)" rows={r.lanes} max={max(r.lanes)} />
        </div>
      )}
    </div>
  )
}

function Table({ title, rows, max, extraHead, extra, deadhead, note }: {
  title: string; rows: Row[]; max: number; extraHead?: string; extra?: (r: Row) => string; deadhead?: boolean; note?: string
}) {
  const [all, setAll] = useState(false)
  const shown = all ? rows : rows.slice(0, 8)
  return (
    <section className="rp-card">
      <h3>{title}</h3>
      <table className="rp-table">
        <thead>
          <tr><th>Name</th><th className="num">Loads</th><th className="num">Gross</th><th className="num">RPM</th>{deadhead && <th className="num">Deadhead</th>}{extraHead && <th className="num" title={note}>{extraHead}</th>}</tr>
        </thead>
        <tbody>
          {shown.map((x) => (
            <tr key={x.key}>
              <td>
                <span className="rp-name">{x.label}{x.sub && <small>{x.sub}</small>}</span>
                <span className="rp-bar" aria-hidden="true"><i style={{ width: `${(x.gross / max) * 100}%` }} /></span>
              </td>
              <td className="num">{x.loads}</td>
              <td className="num strong">{usd(Math.round(x.gross))}</td>
              <td className="num">{fmtRpm(rpm(x.gross, x.miles))}</td>
              {deadhead && <td className="num">{pct(x.empty, x.miles + x.empty)}</td>}
              {extra && <td className="num">{extra(x)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 8 && <button className="w-link rp-more" onClick={() => setAll((v) => !v)}>{all ? 'Show top 8' : `Show all ${rows.length}`}</button>}
    </section>
  )
}

