import type { ScanSettings, Status } from '../hooks/useScanner'
import type { Filters } from '../lib/carrier'

interface Props {
  settings: ScanSettings
  onSettings: (s: ScanSettings) => void
  filters: Filters
  onFilters: (f: Filters) => void
  backendOk: boolean | null
  running: boolean
  status: Status
  hasResults: boolean
  /** Live counters shown while a scan runs. */
  found: number
  checked: number
  onStart: () => void
  onStop: () => void
  onCsv: () => void
  onCopyEmails: () => void
  onCopyPhones: () => void
  onClear: () => void
}

type NumberField = { key: keyof ScanSettings; label: string; placeholder?: string; min: number; max?: number }

const ADVANCED_FIELDS: NumberField[] = [
  { key: 'endMc', label: 'End MC (empty = no limit)', placeholder: '—', min: 1 },
  { key: 'batchSize', label: 'Batch size (MCs per request)', min: 1, max: 200 },
  { key: 'delayMs', label: 'Delay between batches, ms', min: 0 },
  { key: 'saferConcurrency', label: 'Parallel SAFER checks', min: 1, max: 10 },
]

const FILTERS: { key: keyof Filters; label: string }[] = [
  { key: 'onlyWithPhone', label: 'With phone only' },
  { key: 'onlyActive', label: 'USDOT status ACTIVE only' },
  { key: 'skipCarrierBroker', label: 'Skip carrier + broker' },
]

export function ScanPanel(p: Props) {
  const numberInput = (f: NumberField) => (
    <label key={f.key} className="field">
      {f.label}
      <input
        type="number"
        inputMode="numeric"
        min={f.min}
        max={f.max}
        placeholder={f.placeholder}
        value={p.settings[f.key] as string}
        disabled={p.running}
        onChange={(e) => p.onSettings({ ...p.settings, [f.key]: e.target.value })}
      />
    </label>
  )

  return (
    <div className="panel scan-panel">
      <div className="tool-head">
        <h2>Carrier scanner</h2>
        <p>Authorized carriers only · phone &amp; email · verified on SAFER</p>
      </div>
      <div className="controls start-row">
        {numberInput({ key: 'startMc', label: 'Start from MC', min: 1 })}
        <button className={`primary big ${p.running ? 'busy' : ''}`} onClick={p.onStart} disabled={p.running || p.backendOk === false}>
          {p.running ? <><span className="spinner" /> Scanning…</> : <>▶ {p.hasResults ? 'Continue' : 'Start scanning'}</>}
        </button>
        <button className={`big ${p.running ? 'stop' : ''}`} onClick={p.onStop} disabled={!p.running}>⏸ Pause</button>
      </div>

      {p.running && (
        <div className="live" role="status">
          <div className="live-top">
            <span className="pulse" />
            <b>Scanning in progress</b>
            <span className="muted">{p.status.text}</span>
          </div>
          <div className="progress"><i /></div>
          <div className="live-counts">
            <span><b>{p.found.toLocaleString('en-US')}</b> carriers found</span>
            <span><b>{p.checked.toLocaleString('en-US')}</b> MC numbers checked</span>
            <span className="muted">Results appear below as they are found ↓</span>
          </div>
        </div>
      )}

      <div className="controls">
        <label className="check">
          <input
            type="checkbox"
            checked={p.settings.useSafer}
            disabled={p.running}
            onChange={(e) => p.onSettings({ ...p.settings, useSafer: e.target.checked })}
          />
          Verify every carrier on SAFER (live)
        </label>
        {FILTERS.map((f) => (
          <label key={f.key} className="check">
            <input
              type="checkbox"
              checked={p.filters[f.key]}
              onChange={(e) => p.onFilters({ ...p.filters, [f.key]: e.target.checked })}
            />
            {f.label}
          </label>
        ))}
      </div>

      <details className="advanced">
        <summary>Advanced settings</summary>
        <div className="controls">{ADVANCED_FIELDS.map(numberInput)}</div>
        <p className="rules">
          Always: carriers only (brokers are skipped), email required, AUTHORIZED only. With SAFER verification the
          authority status comes live from SAFER for every MC; without it, from the FMCSA files (L&amp;I + Motus).
        </p>
      </details>

      {p.hasResults && (
        <div className="controls actions">
          <button onClick={p.onCsv}>⬇ Download CSV</button>
          <button onClick={p.onCopyEmails}>Copy all emails</button>
          <button onClick={p.onCopyPhones}>Copy all phones</button>
          <button onClick={p.onClear} disabled={p.running}>Clear</button>
        </div>
      )}

      {!p.running && <div className={`status ${p.status.tone === 'error' ? 'error' : ''}`}>{p.status.text}</div>}
      {p.backendOk === false && <div className="status error">Server not reachable. Please reload the page in a minute.</div>}
    </div>
  )
}
