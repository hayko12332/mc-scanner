import { useState } from 'react'
import { track } from '../lib/analytics'
import { authorityLabel, carrierKey } from '../lib/carrier'
import { formatDate, formatNumber, formatPhone } from '../lib/format'
import type { ScannedCarrier } from '../types'
import { CarrierDetails } from './CarrierDetails'
import { Icon, type IconName } from './Icon'

/** Phone or email line: click the value (or the copy button) to copy it. */
function ContactLine({ icon, value, display, hint, onCopy }: {
  icon: IconName
  value: string
  display?: string
  hint?: string
  onCopy: (text: string) => void
}) {
  if (!value) return null
  const copy = () => {
    onCopy(display ?? value)
    track('copy', { what: value.includes('@') ? 'email' : 'phone' })
  }
  return (
    <div className="contact-line">
      <Icon name={icon} size={14} className="contact-icon" />
      <span className="copy contact-value" title={`${value} — click to copy`} onClick={copy}>{display ?? value}</span>
      {hint && <span className="contact-hint">{hint}</span>}
      <button className="icon-btn" title="Copy" aria-label={`Copy ${value}`} onClick={copy}><Icon name="copy" size={13} /></button>
    </div>
  )
}

/** Freshness of a YYYY-MM-DD grant date: label and color level (hot = today/yesterday, warm = this week). */
function freshness(iso: string) {
  const days = Math.max(0, Math.round((Date.now() - Date.parse(iso + 'T12:00:00Z')) / 86_400_000))
  const date = new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  const ago = days === 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days} days ago`
  return { date, ago, level: days <= 1 ? 'hot' : days <= 7 ? 'warm' : 'cool' }
}

/** Authority status as two aligned rows (icon · title · caption) that never wrap mid-phrase. */
function AuthorityCell({ c }: { c: ScannedCarrier }) {
  const verified = !!(c.safer || c.grantedOn)
  const source = c.safer ? `SAFER ${formatDate(c.safer.checkedAt)}` : c.grantedOn ? 'FMCSA' : 'FMCSA files'
  const fresh = c.grantedOn ? freshness(c.grantedOn) : null
  return (
    <div
      className="cell carrier-auth"
      title={c.safer ? `Verified live on SAFER ${formatDate(c.safer.checkedAt)}` : c.grantedOn ? 'Active authority in FMCSA Motus (updated daily)' : 'From FMCSA files (no live SAFER check)'}
    >
      <div className={`auth-line ${verified ? 'ok' : 'warn'}`}>
        <span className="auth-ico"><Icon name={verified ? 'check' : 'shield'} size={14} /></span>
        <span className="auth-text">
          <b>Authorized</b>
          <small>{authorityLabel(c)} · {source}</small>
        </span>
      </div>
      {fresh && (
        <div className={`auth-line fresh-${fresh.level}`}>
          <span className="auth-ico"><Icon name="zap" size={14} /></span>
          <span className="auth-text">
            <b>New · {fresh.ago}</b>
            <small>Granted {fresh.date}</small>
          </span>
        </div>
      )}
    </div>
  )
}

function CarrierRow({ carrier: c, index, onCopy }: { carrier: ScannedCarrier; index: number; onCopy: (text: string) => void }) {
  const [open, setOpen] = useState(false)
  const year = c.addedOn ? new Date(c.addedOn).getFullYear() : null
  const trucks = c.powerUnits ?? 0
  return (
    <div className={`carrier ${open ? 'open' : ''}`}>
      <div className="carrier-row">
        <div className="cell carrier-main">
          <span className="row-num">{index + 1}</span>
          <div className="carrier-name">
            <b title={c.dbaName ? `DBA: ${c.dbaName}` : c.legalName}>{c.legalName}</b>
            <div className="id-chips">
              <span className="id-chip">MC-{c.mc}</span>
              <span className="id-chip">USDOT {c.dot}</span>
            </div>
          </div>
        </div>
        <div className="cell carrier-contact">
          <ContactLine icon="phone" value={c.phone} display={formatPhone(c.phone)} onCopy={onCopy} />
          {c.cellPhone && c.cellPhone !== c.phone && (
            <ContactLine icon="phone" value={c.cellPhone} display={formatPhone(c.cellPhone)} hint="cell" onCopy={onCopy} />
          )}
          <ContactLine icon="mail" value={c.email} onCopy={onCopy} />
        </div>
        <AuthorityCell c={c} />
        <div className="cell carrier-fleet">
          {c.state && <span className="fleet-item"><Icon name="pin" size={14} />{c.state}</span>}
          <span className="fleet-item"><Icon name="truck" size={14} />{formatNumber(trucks)} {trucks === 1 ? 'truck' : 'trucks'}</span>
          {year && <span className="fleet-item muted"><Icon name="calendar" size={14} />Since {year}</span>}
        </div>
        <div className="cell carrier-act">
          <button className={`details-btn ${open ? 'on' : ''}`} onClick={() => {
            if (!open) track('details_open', { mc: c.mc, from: 'scanner' })
            setOpen(!open)
          }}>
            {open ? 'Hide' : 'Details'}<Icon name="chevron" size={14} />
          </button>
        </div>
      </div>
      {open && <div className="carrier-details"><CarrierDetails carrier={c} /></div>}
    </div>
  )
}

interface Props {
  carriers: ScannedCarrier[]
  running: boolean
  /** Singular noun for the count, e.g. "new carrier". */
  noun?: string
  onCopy: (text: string) => void
  onCsv: () => void
  onCopyEmails: () => void
  onCopyPhones: () => void
  onClear: () => void
}

export function ResultsTable({ carriers, running, noun = 'carrier', onCopy, ...actions }: Props) {
  const n = carriers.length
  return (
    <>
      <div className="results-head">
        <h3>
          {n.toLocaleString('en-US')} {n === 1 ? noun : `${noun}s`} found
          {running && <span className="muted"> · scanning…</span>}
        </h3>
        {n > 0 && (
          <div className="results-actions">
            <button className="primary" onClick={actions.onCsv}><Icon name="download" size={16} />Download CSV</button>
            <button onClick={actions.onCopyPhones}><Icon name="phone" size={15} />Copy all phones</button>
            <button onClick={actions.onCopyEmails}><Icon name="mail" size={15} />Copy all emails</button>
            <button onClick={actions.onClear} disabled={running}>Clear</button>
          </div>
        )}
      </div>
      <div className="panel registry">
        {n > 0 && (
          <div className="registry-head" aria-hidden="true">
            <span>Carrier</span><span>Contact</span><span>Authority</span><span>Location &amp; fleet</span><span />
          </div>
        )}
        {carriers.map((c, i) => <CarrierRow key={carrierKey(c)} carrier={c} index={i} onCopy={onCopy} />)}
        {!n && (
          <p className="muted empty">
            {running
              ? 'Loading… the first carriers usually show up within 10–20 seconds.'
              : 'No carriers matching the filters yet. Press Start to scan further.'}
          </p>
        )}
      </div>
    </>
  )
}
