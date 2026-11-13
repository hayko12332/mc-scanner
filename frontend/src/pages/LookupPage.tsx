import { useEffect, useState } from 'react'
import { api } from '../api'
import { CarrierDetails } from '../components/CarrierDetails'
import { PublicRecords } from '../components/PublicRecords'
import { Icon, type IconName } from '../components/Icon'
import { Pill, StatusPill } from '../components/ui'
import { track } from '../lib/analytics'
import { entityLabel } from '../lib/carrier'
import posthog, { isPostHogConfigured } from '../lib/posthog'
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
      <button className="copy-btn" title="Copy" aria-label={`Copy ${display}`} onClick={() => {
        onCopy(display)
        track('copy', { what: value.includes('@') ? 'email' : 'phone', from: 'lookup' })
      }}><Icon name="copy" size={13} /></button>
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
            {formatPhone(p.cellPhone) !== formatPhone(p.phone) && <Contact value={p.cellPhone} display={formatPhone(p.cellPhone)} onCopy={onCopy} />}
            <Contact value={p.email} display={p.email} onCopy={onCopy} />
          </div>
        </div>
        <button className={`details-btn profile-toggle ${open ? 'on' : ''}`} aria-expanded={open} onClick={() => {
          if (!open) track('details_open', { mc: p.mc, dot: p.dot, from: 'lookup' })
          setOpen(!open)
        }}>Details<Icon name="chevron" size={14} /></button>
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
    setLoading(false)
    if (!q) return
    const ctrl = new AbortController()
    setLoading(true)
    api.lookup(q, type, ctrl.signal)
      .then((r) => {
        setResult(r)
        track('lookup', { q, type, kinds: r.kinds.join('+'), results: r.profiles.length })
        if (isPostHogConfigured()) {
          posthog.capture('lookup_completed', {
            lookup_type: type,
            matched_types: r.kinds.join('+'),
            result_count: r.profiles.length,
            results_truncated: r.truncated,
          })
        }
      }, (e: Error) => {
        if (ctrl.signal.aborted) return
        setError(e.message)
        track('lookup_error', { q, type, error: e.message.slice(0, 120) })
        if (isPostHogConfigured()) posthog.capture('lookup_failed', { lookup_type: type })
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
      <section className="hero-band lookup-band">
        <div className="wrap lookup-hero">
          <span className="eyebrow dark">Company lookup</span>
          <h1>Check any carrier <span className="hl">in one search</span></h1>
          <p className="hero-sub">
            Search by MC, USDOT, email or phone: FMCSA record, live SAFER check, insurance, state registration, UCC
            liens and court records — all on one card.
          </p>
          <form className="search-box" onSubmit={submit}>
            <Icon name="search" size={20} className="search-icon" />
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="MC-1650101, USDOT 2952744, info@acme.com or (614) 555-1234"
              aria-label="MC, USDOT, email or phone"
              autoFocus
            />
            <button className="primary big glow" type="submit" disabled={loading}>
              {loading ? <><span className="spinner" /> Searching…</> : <>Search<Icon name="arrow" size={16} /></>}
            </button>
          </form>
          <div className="search-meta">
            <div className="segmented" role="radiogroup" aria-label="Search as">
              {TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  role="radio"
                  aria-checked={inputType === t.value}
                  className={inputType === t.value ? 'on' : ''}
                  onClick={() => setInputType(t.value)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="examples">
              <span>Try:</span>
              <a href={lookupHref('MC-1650101')}>MC-1650101</a>
              <a href={lookupHref('2952744')}>USDOT 2952744</a>
            </div>
          </div>
        </div>
      </section>

      {!q && <WhatYouGet />}

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

const GETS: [IconName, string, string][] = [
  ['shield', 'Authority & SAFER status', 'Common, contract and broker authority from L&I, re-checked live on SAFER.'],
  ['file', 'Insurance & policy history', 'BIPD and cargo on file, active policies with insurers, past cancellations.'],
  ['building', 'Fleet & operation', 'Power units, drivers, cargo types, MCS-150 date, carrier or broker.'],
  ['search', 'Related companies', 'Other USDOT records sharing the same phone or email — spot re-registrations.'],
  ['database', 'State registration', 'Business entity status and officers from the state registry where available.'],
  ['bulb', 'UCC liens & courts', 'Quick links to UCC filings, federal court and bankruptcy records.'],
]

/** Empty state: what one lookup returns. */
function WhatYouGet() {
  return (
    <section className="section lookup-gets">
      <div className="section-head">
        <span className="eyebrow">What you get</span>
        <h2>Everything about a company on one card</h2>
      </div>
      <div className="gets">
        {GETS.map(([icon, title, text]) => (
          <div key={title} className="get">
            <div className="tile-icon"><Icon name={icon} /></div>
            <div>
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
