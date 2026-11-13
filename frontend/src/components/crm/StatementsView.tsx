import { useState } from 'react'
import { saveFile } from '../../lib/export'
import {
  addDays, carrierFee, extras, feeLabel, fmtMiles, fmtRpm, gross, rpm, shortDate, today, usd, weekStart,
  type CrmCarrier, type CrmState, type Load,
} from '../../lib/crm'
import { buildXlsx } from '../../lib/xlsx'
import { Icon } from '../Icon'
import { place } from './LoadsTable'

interface Row { carrier: CrmCarrier; loads: Load[]; gross: number; miles: number; fee: number }

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * Weekly statements: what each carrier grossed Monday–Sunday and the dispatch fee it owes for that week
 * (percent of gross, or the flat weekly fee), printable as a PDF to send to the carrier.
 */
export function StatementsView({ state, toast }: { state: CrmState; toast: (m: string) => void }) {
  // Statements are usually made for the week that just ended.
  const [week, setWeek] = useState(() => addDays(weekStart(today()), -7))
  const end = addDays(week, 6)
  const thisWeek = weekStart(today())
  const truckById = new Map(state.trucks.map((t) => [t.id, t]))

  const rows: Row[] = state.carriers.flatMap((carrier) => {
    const loads = state.loads.filter((l) => l.carrierId === carrier.id && l.date >= week && l.date <= end).sort((a, b) => a.date.localeCompare(b.date))
    if (!loads.length) return []
    return [{ carrier, loads, gross: loads.reduce((s, l) => s + gross(l), 0), miles: loads.reduce((s, l) => s + l.loadedMiles, 0), fee: carrierFee(carrier, loads) }]
  })
  const unassigned = state.loads.filter((l) => l.carrierId == null && l.date >= week && l.date <= end).length
  const total = (k: 'gross' | 'miles' | 'fee') => rows.reduce((s, r) => s + r[k], 0)
  const label = week === thisWeek ? 'This week' : week === addDays(thisWeek, -7) ? 'Last week' : 'Week of'

  const truck = (l: Load) => {
    const t = l.truckId == null ? null : truckById.get(l.truckId)
    return t ? (t.unit ? `#${t.unit}` : t.driver) : ''
  }

  const print = (r: Row) => {
    const w = window.open('', '_blank')
    if (!w) return toast('Allow pop-ups for this site to print the statement')
    const lumper = r.loads.reduce((s, l) => s + l.lumper, 0)
    const body = r.loads.map((l) => `<tr>
      <td>${esc(shortDate(l.date))}</td><td>${esc(l.pro)}</td><td>${esc(l.broker)}</td>
      <td>${esc(place(l.origin))} → ${esc(place(l.destination))}</td><td>${esc(truck(l))}</td>
      <td class="n">${l.loadedMiles ? esc(fmtMiles(l.loadedMiles)) : ''}</td><td class="n">${esc(usd(l.rate))}</td>
      <td class="n">${extras(l) ? esc(usd(extras(l))) : ''}</td><td class="n b">${esc(usd(gross(l)))}</td></tr>`).join('')
    const feeLine = r.carrier.feeType === 'flat'
      ? `Flat weekly dispatch fee`
      : `Dispatch fee: ${r.carrier.fee}% of gross ${esc(usd(r.gross))}`
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Statement ${esc(r.carrier.name)} ${week}</title><style>
      body{font:12.5px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;margin:32px}
      header{display:flex;justify-content:space-between;gap:24px;margin-bottom:22px}
      h1{font-size:20px;margin:0 0 4px} .muted{color:#64748b} .to b{font-size:14px}
      table{width:100%;border-collapse:collapse;margin-top:6px} th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #e2e8f0}
      th{font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;border-bottom:2px solid #0f172a}
      td.n,th.n{text-align:right;font-variant-numeric:tabular-nums} td.b{font-weight:700} tr{break-inside:avoid}
      .sum{margin-left:auto;width:340px;margin-top:18px} .sum div{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #e2e8f0}
      .sum .due{font-size:16px;font-weight:800;border-bottom:2px solid #0f172a} .note{margin-top:26px;font-size:11.5px;color:#64748b}
    </style></head><body>
      <header>
        <div><h1>Dispatch statement</h1><div class="muted">${esc(shortDate(week))} – ${esc(shortDate(end))}, ${week.slice(0, 4)}</div>
          <div class="muted">Prepared by ${esc(state.user.name)}${state.user.email && !state.user.email.endsWith('@leadhaul') ? ` · ${esc(state.user.email)}` : ''}</div></div>
        <div class="to"><div class="muted">To</div><b>${esc(r.carrier.name)}</b>
          <div class="muted">${[r.carrier.mc && `MC-${esc(r.carrier.mc.replace(/\D/g, ''))}`, r.carrier.dot && `USDOT ${esc(r.carrier.dot)}`].filter(Boolean).join(' · ')}</div>
          <div class="muted">${esc(r.carrier.email)}</div></div>
      </header>
      <table><thead><tr><th>Date</th><th>Load #</th><th>Broker</th><th>Lane</th><th>Truck</th><th class="n">Miles</th><th class="n">Rate</th><th class="n">Accessorials</th><th class="n">Gross</th></tr></thead>
      <tbody>${body}</tbody></table>
      <div class="sum">
        <div><span>${r.loads.length} loads · ${esc(fmtMiles(r.miles))} mi · ${esc(fmtRpm(rpm(r.gross, r.miles)))}/mi</span><b>${esc(usd(r.gross))}</b></div>
        <div><span>${feeLine}</span><b>${esc(usd(Math.round(r.fee * 100) / 100))}</b></div>
        <div class="due"><span>Amount due</span><span>${esc(usd(Math.round(r.fee * 100) / 100))}</span></div>
      </div>
      <p class="note">Gross = linehaul rate + detention, layover, TONU and other charges.${lumper ? ` Lumper fees (${esc(usd(lumper))}) are reimbursements and are not part of gross.` : ''}
        ${r.carrier.factoring ? `Factoring: ${esc(r.carrier.factoring)}.` : ''}</p>
      <script>onload=()=>setTimeout(()=>print(),300)</script></body></html>`)
    w.document.close()
  }

  const excel = (r: Row) => {
    const data: (string | number)[][] = r.loads.map((l) => [
      l.date, l.pro, l.broker, place(l.origin), place(l.destination), truck(l), l.loadedMiles || '', l.rate, extras(l) || '', gross(l),
    ])
    data.push([], ['', '', '', '', '', '', r.miles, '', 'Gross', r.gross], ['', '', '', '', '', '', '', '', feeLabel(r.carrier), Math.round(r.fee * 100) / 100])
    saveFile(buildXlsx('Statement', ['Date', 'Load #', 'Broker', 'Origin', 'Destination', 'Truck', 'Miles', 'Rate', 'Accessorials', 'Gross'], data),
      `statement_${r.carrier.name.replace(/\W+/g, '_')}_${week}.xlsx`)
  }

  return (
    <div className="lt">
      <div className="st-top">
        <div className="st-week">
          <button aria-label="Previous week" onClick={() => setWeek(addDays(week, -7))}>‹</button>
          <div><small>{label}</small><b>{shortDate(week)} – {shortDate(end)}</b></div>
          <button aria-label="Next week" disabled={week >= thisWeek} onClick={() => setWeek(addDays(week, 7))}>›</button>
        </div>
        <p>One statement per carrier for the week: loads, gross and the dispatch fee it owes you. Set each carrier’s fee in <b>Carriers</b>.</p>
      </div>

      <div className="lt-kpis">
        <div><span>Gross</span><b>{usd(total('gross'))}</b><small>{rows.reduce((s, r) => s + r.loads.length, 0)} loads · {rows.length} carriers</small></div>
        <div><span>Rate per mile</span><b>{fmtRpm(rpm(rows.reduce((s, r) => s + r.loads.filter((l) => l.loadedMiles).reduce((x, l) => x + gross(l), 0), 0), total('miles')))}</b><small>{fmtMiles(total('miles'))} loaded mi</small></div>
        <div><span>Dispatch fees</span><b className="pos">{usd(Math.round(total('fee')))}</b><small>owed to you for this week</small></div>
        <div><span>Carriers without a fee</span><b>{rows.filter((r) => !r.carrier.fee).length}</b><small>{unassigned ? `${unassigned} loads have no carrier` : 'set it in Carriers'}</small></div>
      </div>

      <div className="lt-scroll">
        <table className="lt-table pv-table">
          <colgroup>
            <col /><col style={{ width: '13%' }} /><col style={{ width: '7%' }} /><col style={{ width: '9%' }} /><col style={{ width: '11%' }} />
            <col style={{ width: '8%' }} /><col style={{ width: '11%' }} /><col style={{ width: '12%' }} /><col style={{ width: 200 }} />
          </colgroup>
          <thead>
            <tr>
              <th>Carrier</th><th>Fee</th><th className="num">Loads</th><th className="num">Miles</th><th className="num">Gross</th>
              <th className="num">RPM</th><th className="num">Fee due</th><th>Factoring</th><th />
            </tr>
          </thead>
          <tbody>
            {!rows.length && <tr className="lt-empty"><td colSpan={9}>No loads with a carrier in this week. Use ‹ to look at earlier weeks.</td></tr>}
            {rows.map((r) => (
              <tr key={r.carrier.id} className="lt-row">
                <td className="pv-name st-name">{r.carrier.name}</td>
                <td className={r.carrier.fee ? 'st-fee' : 'st-fee missing'}>{r.carrier.fee ? feeLabel(r.carrier) : 'No fee set'}</td>
                <td className="num">{r.loads.length}</td>
                <td className="num">{fmtMiles(r.miles)}</td>
                <td className="num">{usd(r.gross)}</td>
                <td className="num">{fmtRpm(rpm(r.loads.filter((l) => l.loadedMiles).reduce((s, l) => s + gross(l), 0), r.miles))}</td>
                <td className="num strong st-due">{usd(Math.round(r.fee * 100) / 100)}</td>
                <td className="st-muted">{r.carrier.factoring || '—'}</td>
                <td className="st-act">
                  <button className="primary" onClick={() => print(r)}><Icon name="file" size={13} />Statement PDF</button>
                  <button className="ghost" onClick={() => excel(r)} title="Download as Excel"><Icon name="download" size={13} /></button>
                </td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={2}>{rows.length} {rows.length === 1 ? 'carrier' : 'carriers'}</td>
                <td className="num">{rows.reduce((s, r) => s + r.loads.length, 0)}</td>
                <td className="num">{fmtMiles(total('miles'))}</td>
                <td className="num">{usd(total('gross'))}</td>
                <td className="num" />
                <td className="num wk-gross">{usd(Math.round(total('fee')))}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}
