import { useState } from 'react'
import { authorityLabel, carrierKey } from '../lib/carrier'
import { formatDate, formatNumber, formatPhone } from '../lib/format'
import type { ScannedCarrier } from '../types'
import { CarrierDetails } from './CarrierDetails'
import { Pill } from './ui'

const COLUMNS = ['MC', 'USDOT', 'Name', 'Phone', 'Cell', 'Email', 'Authority', 'State', 'Trucks', 'Added', '']

function CopyCell({ value, display, onCopy }: { value: string; display?: string; onCopy: (text: string) => void }) {
  return (
    <td className="copy" title={value ? 'Click to copy' : undefined} onClick={() => value && onCopy(value)}>
      {display ?? value}
    </td>
  )
}

function CarrierRow({ carrier: c, onCopy }: { carrier: ScannedCarrier; onCopy: (text: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <tr className="row">
        <td className="num">MC-{c.mc}</td>
        <td className="num">{c.dot}</td>
        <td title={c.dbaName ? `DBA: ${c.dbaName}` : undefined}>{c.legalName}</td>
        <CopyCell value={c.phone} display={formatPhone(c.phone)} onCopy={onCopy} />
        <CopyCell value={c.cellPhone} display={formatPhone(c.cellPhone)} onCopy={onCopy} />
        <CopyCell value={c.email} onCopy={onCopy} />
        <td title={c.safer ? `Verified on SAFER ${formatDate(c.safer.checkedAt)}` : 'From FMCSA files (no SAFER check)'}>
          <Pill tone={c.safer ? 'ok' : 'warn'}>{c.safer ? 'AUTHORIZED ✓ SAFER' : 'AUTHORIZED'}</Pill>
          <span className="muted"> {authorityLabel(c)}</span>
        </td>
        <td>{c.state}</td>
        <td className="num">{formatNumber(c.powerUnits)}</td>
        <td className="num">{formatDate(c.addedOn)}</td>
        <td>
          <button className="small" onClick={() => setOpen(!open)}>{open ? 'Hide ▴' : 'More info ▾'}</button>
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

export function ResultsTable({ carriers, onCopy }: { carriers: ScannedCarrier[]; onCopy: (text: string) => void }) {
  return (
    <div className="panel table-wrap">
      <table className="results">
        <thead>
          <tr>{COLUMNS.map((h, i) => <th key={i}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {carriers.map((c) => <CarrierRow key={carrierKey(c)} carrier={c} onCopy={onCopy} />)}
        </tbody>
      </table>
      {!carriers.length && <p className="muted empty">Nothing yet. Click a phone number or email to copy it.</p>}
    </div>
  )
}
