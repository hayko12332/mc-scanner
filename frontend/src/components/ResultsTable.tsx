import { useState } from 'react'
import { track } from '../lib/analytics'
import { authorityLabel, carrierKey } from '../lib/carrier'
import { formatDate, formatNumber, formatPhone } from '../lib/format'
import type { ScannedCarrier } from '../types'
import { CarrierDetails } from './CarrierDetails'
import { Icon } from './Icon'
import { Pill } from './ui'

const COLUMNS = ['Company', 'Phone', 'Email', 'Authority', 'State', 'Trucks', 'Added', '']

/** A phone or email that copies itself on click. */
function CopyText({ value, display, onCopy }: { value: string; display?: string; onCopy: (text: string) => void }) {
  if (!value) return null
  return (
    <span className="copy" title="Click to copy" onClick={() => {
      onCopy(value)
      track('copy', { what: value.includes('@') ? 'email' : 'phone' })
    }}>
      {display ?? value}
    </span>
  )
}

function CarrierRow({ carrier: c, onCopy }: { carrier: ScannedCarrier; onCopy: (text: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <tr className="row">
        <td className="name wide" data-label="Company" title={c.dbaName ? `DBA: ${c.dbaName}` : undefined}>
          <b>{c.legalName}</b>
          <div className="cell-sub num">MC-{c.mc} · USDOT {c.dot}</div>
        </td>
        <td className="num stack" data-label="Phone">
          <CopyText value={c.phone} display={formatPhone(c.phone)} onCopy={onCopy} />
          {c.cellPhone && c.cellPhone !== c.phone && (
            <span className="cell-sub">cell <CopyText value={c.cellPhone} display={formatPhone(c.cellPhone)} onCopy={onCopy} /></span>
          )}
        </td>
        <td data-label="Email"><CopyText value={c.email} onCopy={onCopy} /></td>
        <td data-label="Authority" title={c.safer ? `Verified on SAFER ${formatDate(c.safer.checkedAt)}` : 'From FMCSA files (no SAFER check)'}>
          <Pill tone={c.safer ? 'ok' : 'warn'}>{c.safer ? 'AUTHORIZED ✓ SAFER' : 'AUTHORIZED'}</Pill>
          <div className="cell-sub">{authorityLabel(c)}</div>
        </td>
        <td data-label="State">{c.state}</td>
        <td className="num" data-label="Trucks">{formatNumber(c.powerUnits)}</td>
        <td className="num" data-label="Added">{formatDate(c.addedOn)}</td>
        <td className="wide">
          <button className="small" onClick={() => {
            if (!open) track('details_open', { mc: c.mc, from: 'scanner' })
            setOpen(!open)
          }}>{open ? 'Hide ▴' : 'More info ▾'}</button>
        </td>
      </tr>
      {open && (
        <tr className="detail-row">
          <td colSpan={COLUMNS.length}><CarrierDetails carrier={c} /></td>
        </tr>
      )}
    </>
  )
}

interface Props {
  carriers: ScannedCarrier[]
  running: boolean
  onCopy: (text: string) => void
  onCsv: () => void
  onCopyEmails: () => void
  onCopyPhones: () => void
  onClear: () => void
}

export function ResultsTable({ carriers, running, onCopy, ...actions }: Props) {
  const n = carriers.length
  return (
    <>
      <div className="results-head">
        <h3>
          {n.toLocaleString('en-US')} {n === 1 ? 'carrier' : 'carriers'} found
          {running && <span className="muted"> · scanning…</span>}
        </h3>
        {n > 0 && (
          <div className="results-actions">
            <button className="primary" onClick={actions.onCsv}><Icon name="download" size={16} />Download CSV</button>
            <button onClick={actions.onCopyPhones}><Icon name="phone" size={15} />Copy all phones</button>
            <button onClick={actions.onCopyEmails}><Icon name="copy" size={15} />Copy all emails</button>
            <button onClick={actions.onClear} disabled={running}>Clear</button>
          </div>
        )}
      </div>
      <div className="panel table-wrap">
      <table className="results">
        <thead>
          <tr>{COLUMNS.map((h, i) => <th key={i}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {carriers.map((c) => <CarrierRow key={carrierKey(c)} carrier={c} onCopy={onCopy} />)}
        </tbody>
      </table>
      {!carriers.length && (
        <p className="muted empty">
          {running
            ? 'Searching… the first carriers usually show up within 10–20 seconds.'
            : 'No carriers matching the filters yet. Press Start to scan further.'}
        </p>
      )}
    </div>
    </>
  )
}
