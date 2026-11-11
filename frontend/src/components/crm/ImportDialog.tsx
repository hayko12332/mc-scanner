import { useMemo, useState } from 'react'
import { parseSheet, usd, type CrmCarrier, type ImportRow } from '../../lib/crm'

const FIELD_NAMES: Record<keyof ImportRow, string> = {
  date: 'Date', broker: 'Broker', pro: 'PRO#', origin: 'Origin', destination: 'Destination', rate: 'Rate', dispatcher: 'Dispatcher (BB)', carrier: 'Carrier',
}

interface Props {
  carriers: CrmCarrier[]
  onImport: (rows: ImportRow[]) => Promise<void>
  onClose: () => void
}

/** Paste a load spreadsheet from Google Sheets or Excel and import it. */
export function ImportDialog({ carriers, onImport, onClose }: Props) {
  const [text, setText] = useState('')
  const [carrier, setCarrier] = useState(carriers[0]?.name ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const parsed = useMemo(() => parseSheet(text, carrier.trim()), [text, carrier])
  const total = parsed.rows.reduce((s, r) => s + r.rate, 0)
  const hasCarrierColumn = parsed.found.includes('carrier')

  const run = async () => {
    setBusy(true)
    setError('')
    try {
      await onImport(parsed.rows)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog wide" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <button className="dialog-close" aria-label="Close" onClick={onClose}>×</button>
        <h3 id="import-title">Import loads from Google Sheets</h3>
        <ol className="dialog-steps">
          <li><b>In your sheet, select the table with its header row and copy it (⌘C / Ctrl+C)</b><span>Columns like Date, Company Name, PRO#, Origin, Destination, Rate, BB are recognized.</span></li>
          <li><b>Paste it below</b><span>Empty rows and separators are skipped.</span></li>
        </ol>
        <textarea className="import-box" placeholder="Paste here…" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
        {!hasCarrierColumn && (
          <label className="field import-carrier">
            Carrier for these loads (one sheet tab = one carrier)
            <input list="import-carriers" value={carrier} placeholder="e.g. BEKU" onChange={(e) => setCarrier(e.target.value)} />
            <datalist id="import-carriers">{carriers.map((c) => <option key={c.id} value={c.name} />)}</datalist>
          </label>
        )}
        {text && (
          <div className="import-preview">
            {parsed.rows.length ? (
              <p className="dialog-ok">{parsed.rows.length} loads · {usd(total)} · columns: {parsed.found.map((f) => FIELD_NAMES[f]).join(', ')}</p>
            ) : (
              <p className="dialog-warn">No loads found. Copy the header row too (it needs a “Date” column).</p>
            )}
            {parsed.skipped.length > 0 && (
              <div className="import-skipped">
                <b>{parsed.skipped.length} row(s) have no date and will be left out — add them by hand if they are loads:</b>
                <ul>{parsed.skipped.slice(0, 5).map((s, i) => <li key={i}>{s}</li>)}</ul>
              </div>
            )}
          </div>
        )}
        {error && <p className="error">{error}</p>}
        <div className="dialog-actions">
          <button className="primary" disabled={!parsed.rows.length || busy} onClick={run}>
            {busy ? 'Importing…' : `Import ${parsed.rows.length || ''} loads`}
          </button>
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
