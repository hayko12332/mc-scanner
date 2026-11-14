import { useMemo, useRef, useState, type DragEvent } from 'react'
import { parseSheet, shortDate, usd, type CrmCarrier, type ImportRow } from '../../lib/crm'
import { ACCEPT, readSheetFile, toTsv } from '../../lib/readSheet'
import { Icon } from '../Icon'

const FIELD_NAMES: Record<keyof ImportRow, string> = {
  date: 'Date', broker: 'Broker', pro: 'Load #', origin: 'Origin', destination: 'Destination', rate: 'Rate', dispatcher: 'Dispatcher', carrier: 'Carrier',
  loadedMiles: 'Miles',
}
const REQUIRED: (keyof ImportRow)[] = ['date', 'broker', 'rate']

interface Props {
  carriers: CrmCarrier[]
  onImport: (rows: ImportRow[]) => Promise<void>
  onClose: () => void
}

type Source = 'file' | 'paste'

/**
 * Import loads like other TMSs do: upload an Excel or CSV file (or drop it on the window), or paste rows from
 * Google Sheets. Columns are matched by their header; a preview shows what will be imported before anything is saved.
 */
export function ImportDialog({ carriers, onImport, onClose }: Props) {
  const [source, setSource] = useState<Source>('file')
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState('')
  const [reading, setReading] = useState(false)
  const [drag, setDrag] = useState(false)
  const [carrier, setCarrier] = useState(carriers[0]?.name ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  // The chosen carrier only fills in loads when the file has no Carrier column at all.
  const parsed = useMemo(() => {
    const own = parseSheet(text, '')
    return own.found.includes('carrier') ? own : parseSheet(text, carrier.trim())
  }, [text, carrier])
  const total = parsed.rows.reduce((s, r) => s + r.rate, 0)
  const hasCarrierColumn = parsed.found.includes('carrier')
  const missing = REQUIRED.filter((f) => !parsed.found.includes(f))

  const readFile = async (file: File | undefined) => {
    if (!file) return
    setError('')
    setReading(true)
    setFileName(file.name)
    try {
      setText(toTsv(await readSheetFile(file)))
    } catch (e) {
      setText('')
      setError((e as Error).message)
    } finally {
      setReading(false)
    }
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDrag(false)
    setSource('file')
    void readFile(e.dataTransfer.files[0])
  }

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

  const reset = () => { setText(''); setFileName(''); setError('') }

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={(e) => { if (e.target === e.currentTarget) setDrag(false) }} onDrop={onDrop}>
      <div className="dialog im" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <header className="im-head">
          <div>
            <h3 id="import-title">Import loads</h3>
            <p>From Excel, CSV or Google Sheets. Nothing is saved until you press Import.</p>
          </div>
          <button className="dialog-close" aria-label="Close" onClick={onClose}>×</button>
        </header>

        <div className="im-tabs" role="tablist">
          <button role="tab" aria-selected={source === 'file'} className={source === 'file' ? 'on' : ''} onClick={() => { setSource('file'); reset() }}>
            <Icon name="download" size={14} />Upload a file
          </button>
          <button role="tab" aria-selected={source === 'paste'} className={source === 'paste' ? 'on' : ''} onClick={() => { setSource('paste'); reset() }}>
            <Icon name="copy" size={14} />Paste from Google Sheets
          </button>
        </div>

        {source === 'file' ? (
          fileName && !error ? (
            <div className="im-file">
              <Icon name="file" size={18} />
              <span><b>{fileName}</b><small>{reading ? 'Reading…' : `${parsed.rows.length} loads found`}</small></span>
              <button className="ghost" onClick={() => { reset(); input.current?.click() }}>Choose another file</button>
            </div>
          ) : (
            <button type="button" className={`im-drop ${drag ? 'drag' : ''}`} onClick={() => input.current?.click()}>
              <span className="im-drop-icon"><Icon name="download" size={22} /></span>
              <b>Drop your file here, or <u>browse</u></b>
              <small>Excel (.xlsx), CSV or TSV · up to 15 MB · the first sheet is read</small>
            </button>
          )
        ) : (
          <>
            <p className="im-hint">In Google Sheets select the table <b>with its header row</b>, copy it (⌘C / Ctrl+C) and paste it here.</p>
            <textarea className="import-box" placeholder="Paste here…" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
          </>
        )}
        <input ref={input} type="file" accept={ACCEPT} hidden onChange={(e) => { void readFile(e.target.files?.[0]); e.target.value = '' }} />

        {!text && !error && (
          <div className="im-columns">
            <b>Columns we recognize</b>
            <div>
              {['Date / Pickup date', 'Broker / Customer', 'Load # / PRO#', 'Origin', 'Destination', 'Rate / Amount', 'Miles', 'Carrier', 'Dispatcher'].map((c) => <span key={c}>{c}</span>)}
            </div>
          </div>
        )}

        {text && !reading && (
          <div className="im-result">
            {parsed.rows.length ? (
              <>
                <div className="im-summary">
                  <span className="im-ok"><Icon name="check" size={14} />{parsed.rows.length} loads · {usd(total)}</span>
                  <span>Matched: {parsed.found.map((f) => FIELD_NAMES[f]).join(', ')}</span>
                </div>
                {missing.length > 0 && <p className="im-warn">No {missing.map((f) => FIELD_NAMES[f]).join(' / ')} column — those fields will be empty; you can fill them in later.</p>}
                <div className="im-preview">
                  <table>
                    <thead><tr><th>Date</th><th>Broker</th><th>Load #</th><th>Lane</th><th className="r">Rate</th><th>Carrier</th></tr></thead>
                    <tbody>
                      {parsed.rows.slice(0, 6).map((r, i) => (
                        <tr key={i}>
                          <td>{shortDate(r.date)}</td><td>{r.broker || '—'}</td><td>{r.pro || '—'}</td>
                          <td>{[r.origin, r.destination].filter(Boolean).join(' → ') || '—'}</td>
                          <td className="r">{r.rate ? usd(r.rate) : '—'}</td><td>{r.carrier || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {parsed.rows.length > 6 && <small>…and {parsed.rows.length - 6} more</small>}
                </div>
              </>
            ) : (
              <p className="im-warn">No loads found. The table needs a header row with a <b>Date</b> column (also “Pickup date” or “Load date”).</p>
            )}
            {parsed.skipped.length > 0 && (
              <details className="im-skipped">
                <summary>{parsed.skipped.length} row(s) without a date will be left out</summary>
                <ul>{parsed.skipped.slice(0, 8).map((s, i) => <li key={i}>{s}</li>)}</ul>
              </details>
            )}
            {!hasCarrierColumn && parsed.rows.length > 0 && (
              <label className="im-carrier">
                <span>Carrier for these loads <small>(the file has no Carrier column)</small></span>
                <input list="import-carriers" value={carrier} placeholder="e.g. BEKU Trucking" onChange={(e) => setCarrier(e.target.value)} />
                <datalist id="import-carriers">{carriers.map((c) => <option key={c.id} value={c.name} />)}</datalist>
              </label>
            )}
          </div>
        )}
        {error && <p className="im-error">{error}</p>}

        <footer className="im-foot">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!parsed.rows.length || busy || reading} onClick={run}>
            {busy ? 'Importing…' : parsed.rows.length ? `Import ${parsed.rows.length} loads` : 'Import'}
          </button>
        </footer>
        {drag && <div className="im-dragging"><Icon name="download" size={28} />Drop the file to import</div>}
      </div>
    </div>
  )
}
