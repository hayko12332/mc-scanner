import { useEffect, type ReactNode } from 'react'
import {
  addDays, carrierFee, daysBetween, feeLabel, fmtMiles, fmtRpm, gross, overdueDays, PAY_TERMS_DAYS, rpm, shortDate, STATUSES, today, usd, weekStart,
  type CrmState, type Load,
} from '../../lib/crm'
import { Icon } from '../Icon'
import { place } from './LoadsTable'

export type KpiKind = 'gross' | 'rpm' | 'fees' | 'pay' | 'unpaid'

interface Props {
  kind: KpiKind
  rows: Load[]
  state: CrmState
  periodLabel: string
  close: () => void
  openLoad: (id: number) => void
  markPaid: (loads: Load[]) => void
  goStatements: () => void
}

const round = (n: number) => Math.round(n)
const nLoads = (n: number) => `${n} ${n === 1 ? 'load' : 'loads'}`
const statusLabel = (s: string) => STATUSES.find((x) => x.id === s)?.label ?? s

/** Horizontal bars: label, the bar sized to the largest value, the value. */
function Bars({ items }: { items: { key: string; label: ReactNode; sub?: ReactNode; value: number; text: string; onClick?: () => void }[] }) {
  const max = Math.max(1, ...items.map((i) => i.value))
  if (!items.length) return <p className="kd-empty">Nothing here for this period.</p>
  return (
    <div className="kd-bars">
      {items.map((i) => (
        <div key={i.key} className={`kd-bar ${i.onClick ? 'click' : ''}`} onClick={i.onClick}>
          <div className="kd-bar-label"><b>{i.label}</b>{i.sub && <small>{i.sub}</small>}</div>
          <div className="kd-bar-track"><i style={{ width: `${Math.max(2, (i.value / max) * 100)}%` }} /></div>
          <span className="kd-bar-val">{i.text}</span>
        </div>
      ))}
    </div>
  )
}

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="kd-sec">
      <div className="kd-sec-head"><h3>{title}</h3>{aside}</div>
      {children}
    </section>
  )
}

function group<K>(loads: Load[], key: (l: Load) => K) {
  const m = new Map<K, Load[]>()
  for (const l of loads) m.set(key(l), [...(m.get(key(l)) ?? []), l])
  return m
}
const sumGross = (ls: Load[]) => ls.reduce((s, l) => s + gross(l), 0)
const loadsRpm = (ls: Load[]) => {
  const withMi = ls.filter((l) => l.loadedMiles > 0)
  return rpm(sumGross(withMi), withMi.reduce((s, l) => s + l.loadedMiles, 0))
}

/**
 * Details behind a KPI tile, the way TMS dashboards drill down: gross by week, carrier and broker; RPM by truck,
 * carrier and lane; dispatch fees per carrier; dispatcher pay; unpaid loads by age with "Mark paid".
 */
export function KpiDrawer({ kind, rows, state, periodLabel, close, openLoad, markPaid, goStatements }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [close])

  const carrierName = (id: number | null) => state.carriers.find((c) => c.id === id)?.name ?? 'No carrier'
  const truckName = (id: number | null) => {
    const t = state.trucks.find((x) => x.id === id)
    return t ? [t.unit && `#${t.unit}`, t.driver].filter(Boolean).join(' · ') : 'No truck'
  }
  const open = (id: number) => { close(); openLoad(id) }
  const total = sumGross(rows)

  let title = ''
  let big = ''
  let sub = ''
  let body: ReactNode = null

  if (kind === 'gross') {
    title = 'Gross'
    big = usd(total)
    sub = `${nLoads(rows.length)} · avg ${usd(rows.length ? round(total / rows.length) : 0)} per load`
    const weeks = [...group(rows, (l) => weekStart(l.date))].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 12)
    const carriers = [...group(rows, (l) => l.carrierId)].sort((a, b) => sumGross(b[1]) - sumGross(a[1]))
    const brokers = [...group(rows, (l) => l.broker.trim() || 'No broker')].sort((a, b) => sumGross(b[1]) - sumGross(a[1])).slice(0, 10)
    body = (
      <>
        <Section title="By week">
          <Bars items={weeks.map(([w, ls]) => ({ key: w, label: `${shortDate(w)} – ${shortDate(addDays(w, 6))}`, sub: `${nLoads(ls.length)}`, value: sumGross(ls), text: usd(sumGross(ls)) }))} />
        </Section>
        <Section title="By carrier">
          <Bars items={carriers.map(([id, ls]) => ({
            key: String(id), label: carrierName(id), sub: `${nLoads(ls.length)} · ${total ? round((sumGross(ls) / total) * 100) : 0}%`, value: sumGross(ls), text: usd(sumGross(ls)),
          }))} />
        </Section>
        <Section title="Top brokers">
          <table className="kd-table">
            <thead><tr><th>Broker</th><th className="r">Loads</th><th className="r">RPM</th><th className="r">Gross</th></tr></thead>
            <tbody>{brokers.map(([b, ls]) => <tr key={b}><td>{b}</td><td className="r">{ls.length}</td><td className="r">{fmtRpm(loadsRpm(ls))}</td><td className="r b">{usd(sumGross(ls))}</td></tr>)}</tbody>
          </table>
        </Section>
      </>
    )
  } else if (kind === 'rpm') {
    const withMi = rows.filter((l) => l.loadedMiles > 0)
    const loaded = withMi.reduce((s, l) => s + l.loadedMiles, 0)
    const empty = withMi.reduce((s, l) => s + l.emptyMiles, 0)
    title = 'Rate per mile'
    big = fmtRpm(loadsRpm(rows))
    sub = `${fmtMiles(loaded)} loaded mi · all-in ${fmtRpm(rpm(sumGross(withMi), loaded + empty))} with ${fmtMiles(empty)} empty mi`
    const byTruck = [...group(withMi, (l) => l.truckId)].sort((a, b) => (loadsRpm(b[1]) ?? 0) - (loadsRpm(a[1]) ?? 0))
    const byCarrier = [...group(withMi, (l) => l.carrierId)].sort((a, b) => (loadsRpm(b[1]) ?? 0) - (loadsRpm(a[1]) ?? 0))
    const ranked = [...withMi].sort((a, b) => (rpm(gross(b), b.loadedMiles) ?? 0) - (rpm(gross(a), a.loadedMiles) ?? 0))
    const loadRow = (l: Load) => (
      <tr key={l.id} className="click" onClick={() => open(l.id)}>
        <td>{shortDate(l.date)}</td><td>{place(l.origin)} → {place(l.destination)}</td><td className="r">{fmtMiles(l.loadedMiles)}</td>
        <td className="r">{usd(gross(l))}</td><td className="r b">{fmtRpm(rpm(gross(l), l.loadedMiles))}</td>
      </tr>
    )
    body = (
      <>
        <div className="kd-stats">
          <div><span>Loaded miles</span><b>{fmtMiles(loaded)}</b></div>
          <div><span>Empty miles</span><b>{fmtMiles(empty)}</b></div>
          <div><span>Deadhead</span><b>{loaded + empty ? round((empty / (loaded + empty)) * 100) : 0}%</b></div>
          <div><span>No miles yet</span><b>{rows.length - withMi.length}</b></div>
        </div>
        <Section title="By truck">
          <Bars items={byTruck.map(([id, ls]) => ({ key: String(id), label: truckName(id), sub: `${nLoads(ls.length)} · ${fmtMiles(ls.reduce((s, l) => s + l.loadedMiles, 0))} mi`, value: loadsRpm(ls) ?? 0, text: fmtRpm(loadsRpm(ls)) }))} />
        </Section>
        <Section title="By carrier">
          <Bars items={byCarrier.map(([id, ls]) => ({ key: String(id), label: carrierName(id), sub: `${nLoads(ls.length)}`, value: loadsRpm(ls) ?? 0, text: fmtRpm(loadsRpm(ls)) }))} />
        </Section>
        <Section title="Best-paying loads">
          <table className="kd-table"><thead><tr><th>Date</th><th>Lane</th><th className="r">Miles</th><th className="r">Gross</th><th className="r">RPM</th></tr></thead>
            <tbody>{ranked.slice(0, 5).map(loadRow)}</tbody></table>
        </Section>
        {ranked.length > 5 && (
          <Section title="Lowest-paying loads">
            <table className="kd-table"><thead><tr><th>Date</th><th>Lane</th><th className="r">Miles</th><th className="r">Gross</th><th className="r">RPM</th></tr></thead>
              <tbody>{ranked.slice(-5).reverse().map(loadRow)}</tbody></table>
          </Section>
        )}
      </>
    )
  } else if (kind === 'fees') {
    const perCarrier = state.carriers.map((c) => {
      const mine = rows.filter((l) => l.carrierId === c.id)
      const fee = [...group(mine, (l) => weekStart(l.date)).values()].reduce((s, ls) => s + carrierFee(c, ls), 0)
      return { c, loads: mine, gross: sumGross(mine), fee }
    }).filter((x) => x.loads.length).sort((a, b) => b.fee - a.fee)
    const totalFee = perCarrier.reduce((s, x) => s + x.fee, 0)
    const noFee = perCarrier.filter((x) => !x.c.fee)
    title = 'Dispatch fees'
    big = usd(round(totalFee))
    sub = `owed by ${perCarrier.length} carriers for ${usd(sumGross(perCarrier.flatMap((x) => x.loads)))} gross`
    body = (
      <>
        {noFee.length > 0 && <p className="kd-warn"><Icon name="lifebuoy" size={15} />{noFee.map((x) => x.c.name).join(', ')} {noFee.length === 1 ? 'has' : 'have'} no fee set — set it in Carriers.</p>}
        <Section title="By carrier" aside={<button className="ghost kd-act" onClick={() => { close(); goStatements() }}>Weekly statements →</button>}>
          <table className="kd-table">
            <thead><tr><th>Carrier</th><th>Fee</th><th className="r">Loads</th><th className="r">Gross</th><th className="r">Fee due</th></tr></thead>
            <tbody>{perCarrier.map((x) => (
              <tr key={x.c.id}><td>{x.c.name}</td><td className={x.c.fee ? '' : 'bad'}>{x.c.fee ? feeLabel(x.c) : 'Not set'}</td><td className="r">{x.loads.length}</td>
                <td className="r">{usd(x.gross)}</td><td className="r b">{usd(Math.round(x.fee * 100) / 100)}</td></tr>
            ))}</tbody>
            <tfoot><tr><td colSpan={4}>Total</td><td className="r b">{usd(Math.round(totalFee * 100) / 100)}</td></tr></tfoot>
          </table>
        </Section>
      </>
    )
  } else if (kind === 'pay') {
    const per = state.dispatchers.map((d) => {
      const mine = rows.filter((l) => l.dispatcherId === d.id)
      return { d, loads: mine, gross: sumGross(mine), pay: (sumGross(mine) * d.percent) / 100 }
    }).sort((a, b) => b.pay - a.pay)
    const unassigned = rows.filter((l) => l.dispatcherId == null)
    const totalPay = per.reduce((s, x) => s + x.pay, 0)
    title = 'Dispatcher pay'
    big = usd(round(totalPay))
    sub = `${per.filter((x) => x.loads.length).length} dispatchers · by each one’s percent of gross`
    body = (
      <>
        {unassigned.length > 0 && <p className="kd-warn"><Icon name="lifebuoy" size={15} />{nLoads(unassigned.length)} ({usd(sumGross(unassigned))}) have no dispatcher — they are not in anyone’s pay.</p>}
        <Section title="By dispatcher">
          <table className="kd-table">
            <thead><tr><th>Dispatcher</th><th className="r">Percent</th><th className="r">Loads</th><th className="r">Gross</th><th className="r">Pay</th></tr></thead>
            <tbody>{per.map((x) => (
              <tr key={x.d.id}><td>{x.d.name}</td><td className="r">{x.d.percent}%</td><td className="r">{x.loads.length}</td><td className="r">{usd(x.gross)}</td><td className="r b">{usd(Math.round(x.pay * 100) / 100)}</td></tr>
            ))}</tbody>
            <tfoot><tr><td colSpan={4}>Total</td><td className="r b">{usd(Math.round(totalPay * 100) / 100)}</td></tr></tfoot>
          </table>
        </Section>
        <Section title="Pay by week">
          <Bars items={[...group(rows.filter((l) => l.dispatcherId != null), (l) => weekStart(l.date))].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 10).map(([w, ls]) => {
            const p = ls.reduce((s, l) => s + (gross(l) * (state.dispatchers.find((d) => d.id === l.dispatcherId)?.percent ?? 0)) / 100, 0)
            return { key: w, label: `${shortDate(w)} – ${shortDate(addDays(w, 6))}`, sub: `${nLoads(ls.length)}`, value: p, text: usd(round(p)) }
          })} />
        </Section>
      </>
    )
  } else {
    const unpaid = rows.filter((l) => l.status !== 'paid')
    const notInvoiced = unpaid.filter((l) => !l.invoicedOn)
    const invoiced = unpaid.filter((l) => l.invoicedOn)
    const current = invoiced.filter((l) => overdueDays(l) === 0)
    const late30 = invoiced.filter((l) => overdueDays(l) > 0 && overdueDays(l) <= 30)
    const late60 = invoiced.filter((l) => overdueDays(l) > 30)
    title = 'Not paid yet'
    big = usd(sumGross(unpaid))
    sub = `${nLoads(unpaid.length)} · net ${PAY_TERMS_DAYS} from the invoice date`
    const buckets: [string, Load[], string][] = [
      ['Not invoiced yet', notInvoiced, ''], ['Invoiced · on time', current, 'ok'], ['1–30 days late', late30, 'warn'], ['Over 30 days late', late60, 'bad'],
    ]
    const sorted = [...unpaid].sort((a, b) => overdueDays(b) - overdueDays(a) || (a.invoicedOn ?? '9').localeCompare(b.invoicedOn ?? '9') || a.date.localeCompare(b.date))
    body = (
      <>
        <div className="kd-aging">
          {buckets.map(([label, ls, cls]) => (
            <div key={label} className={cls}><span>{label}</span><b>{usd(sumGross(ls))}</b><small>{nLoads(ls.length)}</small></div>
          ))}
        </div>
        <Section title="Unpaid loads" aside={late30.length + late60.length > 0 ? <span className="kd-note">{late30.length + late60.length} overdue</span> : undefined}>
          {!sorted.length ? <p className="kd-empty">Everything in this period is paid.</p> : (
            <table className="kd-table">
              <thead><tr><th>Load</th><th>Status</th><th>Invoiced</th><th className="r">Due</th><th className="r">Amount</th><th /></tr></thead>
              <tbody>{sorted.map((l) => {
                const late = overdueDays(l)
                const due = l.invoicedOn ? addDays(l.invoicedOn, PAY_TERMS_DAYS) : null
                return (
                  <tr key={l.id} className="click" onClick={(e) => { if (!(e.target as HTMLElement).closest('button')) open(l.id) }}>
                    <td><b>{l.broker || 'No broker'}</b><small>{shortDate(l.date)}{l.pro ? ` · #${l.pro}` : ''}</small></td>
                    <td>{statusLabel(l.status)}</td>
                    <td>{l.invoicedOn ? shortDate(l.invoicedOn) : <span className="muted">—</span>}</td>
                    <td className={`r ${late ? 'bad' : ''}`}>{due ? (late ? `${late}d late` : `in ${daysBetween(today(), due)}d`) : '—'}</td>
                    <td className="r b">{usd(gross(l))}</td>
                    <td className="r"><button className="kd-paid" onClick={() => markPaid([l])}>Mark paid</button></td>
                  </tr>
                )
              })}</tbody>
            </table>
          )}
        </Section>
      </>
    )
  }

  return (
    <div className="ld-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <aside className="ld kd" role="dialog" aria-label={`${title} details`}>
        <header className="ld-head kd-head">
          <div>
            <small>{periodLabel}</small>
            <h2>{title}</h2>
            <p className="kd-big">{big}</p>
            <p className="kd-sub">{sub}</p>
          </div>
          <button className="ld-x" aria-label="Close" onClick={close}>×</button>
        </header>
        <div className="ld-body">{body}</div>
      </aside>
    </div>
  )
}
