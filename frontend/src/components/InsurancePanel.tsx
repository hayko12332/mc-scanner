import { useEffect, useState } from 'react'
import { api } from '../api'
import { formatDate, formatMoney } from '../lib/format'
import type { Insurance, Policy } from '../types'

// Insurance rarely changes within a session; load each MC once.
const cache = new Map<number, Promise<Insurance>>()
const loadInsurance = (mc: number) => {
  if (!cache.has(mc)) cache.set(mc, api.insurance(mc).catch((e) => { cache.delete(mc); throw e }))
  return cache.get(mc)!
}

function PolicyTable({ policies, lastColumn }: { policies: Policy[]; lastColumn: 'Posted' | 'Reason' }) {
  return (
    <div className="table-scroll">
    <table className="policies">
      <thead>
        <tr>
          <th>Type</th><th>Insurer</th><th>Policy</th><th>Coverage</th><th>Effective</th><th>Cancelled</th><th>{lastColumn}</th>
        </tr>
      </thead>
      <tbody>
        {policies.map((p, i) => (
          <tr key={`${p.policyNumber}-${i}`}>
            <td>{p.type || '—'}</td>
            <td>{p.company || '—'}</td>
            <td>{p.policyNumber || '—'}</td>
            <td>{formatMoney(p.amount)}{p.underlying ? ` (underlying ${formatMoney(p.underlying)})` : ''}</td>
            <td>{formatDate(p.effectiveDate)}</td>
            <td>{formatDate(p.cancelledDate)}</td>
            <td>{lastColumn === 'Posted' ? formatDate(p.postedDate) : p.reason}</td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  )
}

export function InsurancePanel({ mc }: { mc: number }) {
  const [insurance, setInsurance] = useState<Insurance | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    loadInsurance(mc).then(
      (data) => live && setInsurance(data),
      (e: Error) => live && setError(e.message),
    )
    return () => { live = false }
  }, [mc])

  if (error) return <div className="muted">Could not load: {error}</div>
  if (!insurance) return <div className="muted">Loading…</div>
  return (
    <div>
      {insurance.current.length
        ? <PolicyTable policies={insurance.current} lastColumn="Posted" />
        : <div className="muted">No active policies.</div>}
      <p className="note">
        {insurance.source === 'Motus'
          ? 'Source: Motus (current FMCSA system).'
          : 'Source: legacy L&I file — it has received no new filings since May 2026, so this may be out of date.'}
      </p>
      {insurance.past.length > 0 && (
        <details className="past-policies">
          <summary>Past policies ({insurance.past.length})</summary>
          <PolicyTable policies={insurance.past} lastColumn="Reason" />
        </details>
      )}
    </div>
  )
}
