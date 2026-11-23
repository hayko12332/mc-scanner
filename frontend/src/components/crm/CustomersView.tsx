import { Fragment, useMemo, useState } from 'react'
import { daysBetween, gross, margin, overdueDays, shortDate, usd, type CrmState, type Load } from '../../lib/crm'
import { Icon } from '../Icon'
import { place } from './LoadsTable'

// Brokerage boards: the customers (shippers) the loads come from, built from the loads themselves — how much each one
// brings, the margin on it, what it owes and how fast it pays, its billing email. A click shows its loads.

interface Customer {
  key: string; name: string; loads: Load[]; gross: number; margin: number; priced: number
  open: number; overdue: number; last: string; payDays: number | null; email: string
}

export function CustomersView({ state, openLoad }: { state: CrmState; openLoad: (id: number) => void }) {
  const [q, setQ] = useState('')
  const [shown, setShown] = useState<string | null>(null)
  const rows = useMemo(() => {
    const m = new Map<string, Load[]>()
    for (const l of state.loads) {
      const k = l.broker.trim().toLowerCase()
      if (k) m.set(k, [...(m.get(k) ?? []), l])
    }
    return [...m].map(([key, ls]): Customer => {
      const paid = ls.filter((l) => l.invoicedOn && l.paidOn)
      const priced = ls.filter((l) => margin(l) != null)
      return {
        key, name: ls[0].broker.trim(), loads: [...ls].sort((a, b) => b.date.localeCompare(a.date)),
        gross: ls.reduce((s, l) => s + gross(l), 0), margin: priced.reduce((s, l) => s + (margin(l) ?? 0), 0), priced: priced.length,
        open: ls.filter((l) => l.status === 'invoiced').reduce((s, l) => s + gross(l) + l.lumper, 0),
        overdue: ls.filter((l) => overdueDays(l) > 0).reduce((s, l) => s + gross(l) + l.lumper, 0),
        last: ls.reduce((a, l) => (l.date > a ? l.date : a), ''),
        payDays: paid.length ? Math.round(paid.reduce((s, l) => s + daysBetween(l.invoicedOn!, l.paidOn!), 0) / paid.length) : null,
        email: state.brokerEmails?.[key] ?? '',
      }
    }).sort((a, b) => b.gross - a.gross)
  }, [state.loads, state.brokerEmails])
  const needle = q.trim().toLowerCase()
  const list = needle ? rows.filter((r) => r.key.includes(needle) || r.email.includes(needle)) : rows
  const total = (f: (r: Customer) => number) => list.reduce((s, r) => s + f(r), 0)

  return (
    <div className="lt">
      <div className="lt-filters">
        <label className="lt-search"><Icon name="search" size={14} /><input placeholder="Search customers or emails…" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      </div>
      <div className="lt-scroll">
        <table className="lt-table pv-table">
          <thead>
            <tr>
              <th>Customer</th><th>Billing email</th><th className="num">Loads</th><th className="num">Revenue</th><th className="num">Margin</th>
              <th className="num">Open</th><th className="num">Pays in</th><th className="num">Last load</th>
            </tr>
          </thead>
          <tbody>
            {!list.length && <tr className="lt-empty"><td colSpan={8}>{rows.length ? 'No customer matches.' : 'No customers yet — they appear here from your loads (the Customer field of each load).'}</td></tr>}
            {list.map((r) => (
              <Fragment key={r.key}>
                <tr className="lt-row cu-row" onClick={() => setShown((x) => (x === r.key ? null : r.key))}>
                  <td className="pv-name"><b>{r.name}</b></td>
                  <td className="pv-muted">{r.email || '—'}</td>
                  <td className="num">{r.loads.length}</td>
                  <td className="num strong">{usd(Math.round(r.gross))}</td>
                  <td className="num">{r.priced ? `${usd(Math.round(r.margin))}${r.gross ? ` · ${Math.round((r.margin / r.loads.filter((l) => margin(l) != null).reduce((s, l) => s + gross(l), 0)) * 100)}%` : ''}` : '—'}</td>
                  <td className={`num ${r.overdue ? 'bad' : ''}`} title={r.overdue ? `${usd(Math.round(r.overdue))} overdue` : undefined}>{r.open ? usd(Math.round(r.open)) : '—'}</td>
                  <td className="num">{r.payDays != null ? `${r.payDays} days` : '—'}</td>
                  <td className="num">{r.last ? shortDate(r.last) : '—'}</td>
                </tr>
                {shown === r.key && (
                  <tr className="cu-loads">
                    <td colSpan={8}>
                      <ul>
                        {r.loads.slice(0, 20).map((l) => (
                          <li key={l.id}><button type="button" className="w-link" onClick={() => openLoad(l.id)}>
                            {shortDate(l.date)}{l.pro ? ` · #${l.pro}` : ''} · {place(l.origin) || '—'} → {place(l.destination) || '—'} · {usd(gross(l))}{margin(l) != null ? ` · margin ${usd(Math.round(margin(l)!))}` : ''} · {l.status.replace('_', ' ')}
                          </button></li>
                        ))}
                        {r.loads.length > 20 && <li className="pv-muted">and {r.loads.length - 20} more on the Loads tab</li>}
                      </ul>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
          {list.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={2}>{list.length} {list.length === 1 ? 'customer' : 'customers'}</td>
                <td className="num">{total((r) => r.loads.length)}</td>
                <td className="num wk-gross">{usd(Math.round(total((r) => r.gross)))}</td>
                <td className="num">{usd(Math.round(total((r) => r.margin)))}</td>
                <td className="num">{usd(Math.round(total((r) => r.open)))}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}
