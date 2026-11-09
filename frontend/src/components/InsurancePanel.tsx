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

/** Policies as compact cards (no horizontal scrolling, works in narrow columns and on phones). */
function PolicyTable({ policies, lastColumn }: { policies: Policy[]; lastColumn: 'Posted' | 'Reason' }) {
  return (
    <div className="policy-list">
      {policies.map((p, i) => (
        <div key={`${p.policyNumber}-${i}`} className="policy">
          <div className="policy-top">
            <b>{p.type || '—'}</b>
            <span className="policy-amt">
              {formatMoney(p.amount)}{p.underlying ? ` (underlying ${formatMoney(p.underlying)})` : ''}
            </span>
          </div>
          <div className="policy-co">{p.company || '—'}</div>
          <div className="policy-meta">
            <span>Policy <b>{p.policyNumber || '—'}</b></span>
            <span>Effective <b>{formatDate(p.effectiveDate)}</b></span>
            {p.cancelledDate && <span>Cancelled <b>{formatDate(p.cancelledDate)}</b></span>}
            {lastColumn === 'Posted'
              ? <span>Posted <b>{formatDate(p.postedDate)}</b></span>
              : p.reason && <span>Reason <b>{p.reason}</b></span>}
          </div>
        </div>
      ))}
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
