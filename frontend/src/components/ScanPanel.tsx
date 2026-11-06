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
  onStart: () => void
  onStop: () => void
  onCsv: () => void
  onCopyEmails: () => void
  onCopyPhones: () => void
  onClear: () => void
}

const NUMBER_FIELDS: { key: keyof ScanSettings; label: string; placeholder?: string; min: number; max?: number }[] = [
  { key: 'startMc', label: 'Start MC', min: 1 },
  { key: 'endMc', label: 'End MC (empty = no limit)', placeholder: '—', min: 1 },
  { key: 'batchSize', label: 'Batch size (MCs per request)', min: 1, max: 200 },
  { key: 'delayMs', label: 'Delay between batches, ms', min: 0 },
  { key: 'saferConcurrency', label: 'Parallel SAFER checks', min: 1, max: 10 },
]

const FILTERS: { key: keyof Filters; label: string }[] = [
  { key: 'skipCarrierBroker', label: 'Skip carrier + broker' },
  { key: 'onlyActive', label: 'USDOT status ACTIVE only' },
  { key: 'onlyWithPhone', label: 'With phone only' },
]

export function ScanPanel(p: Props) {
  const backendState =
    p.backendOk == null ? 'Connecting to backend…' : p.backendOk ? '✓ Backend connected' : '✗ Backend not reachable'
  return (
    <div className="panel">
      <div className="controls">
        {NUMBER_FIELDS.map((f) => (
          <label key={f.key} className="field">
            {f.label}
            <input
              type="number"
              min={f.min}
              max={f.max}
              placeholder={f.placeholder}
              value={p.settings[f.key] as string}
              disabled={p.running}
              onChange={(e) => p.onSettings({ ...p.settings, [f.key]: e.target.value })}
            />
          </label>
        ))}
      </div>
      <div className="controls">
        <label className="check">
          <input
            type="checkbox"
            checked={p.settings.useSafer}
            disabled={p.running}
            onChange={(e) => p.onSettings({ ...p.settings, useSafer: e.target.checked })}
          />
          Verify every MC on SAFER (live)
        </label>
        <span className={`muted small-text ${p.backendOk === false ? 'error' : ''}`}>{backendState}</span>
      </div>
      <div className="controls">
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
      <p className="rules">
        Always: carriers only (brokers are skipped), email required, AUTHORIZED only. With SAFER verification the
        authority status comes live from SAFER for every MC; without it, from the FMCSA files (L&amp;I + Motus).
      </p>
      <div className="controls">
        <button className="primary" onClick={p.onStart} disabled={p.running || p.backendOk === false}>▶ Start</button>
        <button onClick={p.onStop} disabled={!p.running}>⏸ Pause</button>
        <button onClick={p.onCsv}>⬇ CSV</button>
        <button onClick={p.onCopyEmails}>Copy emails</button>
        <button onClick={p.onCopyPhones}>Copy phones</button>
        <button onClick={p.onClear} disabled={p.running}>Clear</button>
      </div>
      <div className={`status ${p.status.tone === 'error' ? 'error' : ''}`}>{p.status.text}</div>
    </div>
  )
}
