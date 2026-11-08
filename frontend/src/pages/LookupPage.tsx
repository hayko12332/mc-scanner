import { useEffect, useState } from 'react'
import { api } from '../api'
import { CarrierDetails } from '../components/CarrierDetails'
import { PublicRecords } from '../components/PublicRecords'
import { Pill, StatusPill } from '../components/ui'
import { track } from '../lib/analytics'
import { entityLabel } from '../lib/carrier'
import { formatPhone } from '../lib/format'
import { checkSafer } from '../lib/safer'
import type { CarrierProfile, LookupResult, LookupType, SaferChecked } from '../types'

const TYPES: { value: LookupType; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'mc', label: 'MC' },
  { value: 'dot', label: 'USDOT' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
]
const KIND_LABEL = { mc: 'MC', dot: 'USDOT', email: 'email', phone: 'phone' }
/** Show every profile fully only for small result sets; larger ones start collapsed. */
const EXPAND_UP_TO = 3

export const lookupHref = (q: string, type: LookupType = 'auto') =>
  `#/lookup?${new URLSearchParams(type === 'auto' ? { q } : { q, type })}`

function SaferLive({ mc, onResult }: { mc: number; onResult: (s: SaferChecked | null) => void }) {
  const [status, setStatus] = useState('Checking SAFER…')

  useEffect(() => {
    const ctrl = new AbortController()
    setStatus('Checking SAFER…')
    checkSafer(mc, ctrl.signal, setStatus).then(
      (snap) => {
        if (snap.found) {
          onResult({ ...snap, checkedAt: new Date().toISOString() })
          setStatus('')
        } else {
          onResult(null)
          setStatus(`MC-${mc} is not on SAFER.`)
        }
      },
      (e: Error) => !ctrl.signal.aborted && setStatus(`SAFER check failed: ${e.message}`),
    )
    return () => ctrl.abort()
  }, [mc, onResult])

  return status ? <p className="muted small-text">{status}</p> : null
}

function Contact({ value, display, onCopy }: { value: string; display: string; onCopy: (text: string) => void }) {
  if (!value) return null
  return (
    <span className="contact">
      <a href={lookupHref(value)} title="Find every company with this contact">{display}</a>
      <button className="small icon" title="Copy" onClick={() => {
        onCopy(display)
        track('copy', { what: value.includes('@') ? 'email' : 'phone', from: 'lookup' })
      }}>⧉</button>
    </span>
  )
}

function ProfileCard({ p, expanded, onCopy }: { p: CarrierProfile; expanded: boolean; onCopy: (text: string) => void }) {
  const [open, setOpen] = useState(expanded)
  const [safer, setSafer] = useState<SaferChecked | null>(null)
  const a = p.authority
  const carrierAuthority = a && (a.common === 'A' || a.contract === 'A' || a.motusCarrier === 'A')

  return (
    <section className="panel profile">
      <div className="profile-head">
        <div>
          <h2>{p.legalName || '(no name)'}{p.dbaName && <span className="muted"> · DBA {p.dbaName}</span>}</h2>
          <div className="profile-meta">
            {p.mc != null && <span>MC-{p.mc}</span>}
            <span>USDOT {p.dot}</span>
            {p.state && <span>{p.state}</span>}
            <span>{entityLabel(p.entityTypes)}</span>
            <span>USDOT <StatusPill code={p.usdotStatus} /></span>
            <span>Authority {a ? <Pill tone={carrierAuthority ? 'ok' : 'bad'}>{carrierAuthority ? 'ACTIVE' : 'NOT ACTIVE'}</Pill> : <Pill tone="bad">NONE</Pill>}</span>
          </div>
          <div className="profile-contacts">
            <Contact value={p.phone} display={formatPhone(p.phone)} onCopy={onCopy} />
            <Contact value={p.cellPhone} display={formatPhone(p.cellPhone)} onCopy={onCopy} />
            <Contact value={p.email} display={p.email} onCopy={onCopy} />
          </div>
        </div>
        <button className="small" onClick={() => {
          if (!open) track('details_open', { mc: p.mc, dot: p.dot, from: 'lookup' })
          setOpen(!open)
        }}>{open ? 'Hide ▴' : 'Details ▾'}</button>
      </div>
      {open && (
        <>
          {p.mc != null && <SaferLive mc={p.mc} onResult={setSafer} />}
          <CarrierDetails carrier={{ ...p, safer: safer ?? undefined }} />
          <h3 className="section-title">Public records</h3>
          <PublicRecords name={p.legalName} state={p.state} officers={p.officers} />
        </>
      )}
    </section>
  )
}

function readHash(hash: string): { q: string; type: LookupType } {
  const params = new URLSearchParams(hash.split('?')[1] ?? '')
  const type = params.get('type') as LookupType | null
  return { q: params.get('q') ?? '', type: TYPES.some((t) => t.value === type) ? type! : 'auto' }
}

export function LookupPage({ hash, copy }: { hash: string; copy: (text: string) => void }) {
  const { q, type } = readHash(hash)
  const [input, setInput] = useState(q)
  const [inputType, setInputType] = useState<LookupType>(type)
  const [result, setResult] = useState<LookupResult | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // The URL is the source of truth, so contact links, back/forward and shared links all work.
  useEffect(() => {
    setInput(q)
    setInputType(type)
    setResult(null)
    setError('')
    if (!q) return
    const ctrl = new AbortController()
    setLoading(true)
    api.lookup(q, type, ctrl.signal)
      .then((r) => {
        setResult(r)
        track('lookup', { q, type, kinds: r.kinds.join('+'), results: r.profiles.length })
      }, (e: Error) => {
        if (ctrl.signal.aborted) return
        setError(e.message)
        track('lookup_error', { q, type, error: e.message.slice(0, 120) })
      })
      .finally(() => !ctrl.signal.aborted && setLoading(false))
    return () => ctrl.abort()
  }, [q, type])

  const submit = (e: { preventDefault(): void }) => {
    e.preventDefault()
    if (input.trim()) location.hash = lookupHref(input.trim(), inputType)
  }

  const shared = result && result.profiles.length > 1 && result.kinds.some((k) => k === 'email' || k === 'phone')

  return (
    <>
      <p className="sub">
        Look up one company by MC number, USDOT number, email or phone: FMCSA record, live SAFER check, insurance,
        state business registration, UCC liens and court records.
      </p>
      <form className="panel controls" onSubmit={submit}>
        <label className="field grow">
          MC, USDOT, email or phone
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="MC-1650101, 2952744, info@acme.com, (614) 555-1234" autoFocus />
        </label>
        <label className="field">
          Search as
          <select value={inputType} onChange={(e) => setInputType(e.target.value as LookupType)}>
            {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>
        <button className="primary" type="submit" disabled={loading}>{loading ? 'Searching…' : 'Search'}</button>
      </form>

      {error && <p className="panel error">{error}</p>}
      {result && (
        <>
          <p className="result-summary">
            {result.profiles.length
              ? `${result.profiles.length}${result.truncated ? '+' : ''} ${result.profiles.length === 1 ? 'company' : 'companies'} for ${result.kinds.map((k) => KIND_LABEL[k]).join(' or ')} “${result.query}”.`
              : `Nothing in the FMCSA census for ${result.kinds.map((k) => KIND_LABEL[k]).join(' or ')} “${result.query}”.`}
            {shared && (
              <> <Pill tone="warn">SHARED CONTACT</Pill> The same {result.kinds[0]} is on several USDOT records — they may be
                related companies or a carrier that re-registered under a new number.</>
            )}
          </p>
          {result.profiles.map((p) => (
            <ProfileCard key={p.dot + '|' + p.mc} p={p} expanded={result.profiles.length <= EXPAND_UP_TO} onCopy={copy} />
          ))}
        </>
      )}
    </>
  )
}
