import { Icon } from './Icon'
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
  onViewResults: () => void
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

  const state = p.backendOk === false ? ['offline', 'Server offline'] : p.running ? ['busy', 'Scanning'] : ['ready', 'Ready']

  return (
    <div className="panel scan-panel">
      <div className="scan-head">
        <div className="tile-icon"><Icon name="scan" /></div>
        <div className="scan-title">
          <h2>Carrier scanner</h2>
          <p>Authorized carriers only · phone &amp; email · verified on SAFER</p>
        </div>
        <span className={`state-chip ${state[0]}`}><span className="state-dot" />{state[1]}</span>
      </div>

      <div className="scan-row">
        <label className="mc-input">
          <span className="mc-prefix">MC</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            aria-label="Starting MC number"
            placeholder="Starting MC number"
            value={p.settings.startMc}
            disabled={p.running}
            onChange={(e) => p.onSettings({ ...p.settings, startMc: e.target.value })}
          />
        </label>
        <button className={`primary big glow scan-go ${p.running ? 'busy' : ''}`} onClick={p.onStart} disabled={p.running || p.backendOk === false}>
          {p.running ? <><span className="spinner" /> Scanning…</> : <><Icon name="play" size={16} />{p.hasResults ? 'Continue scan' : 'Start scanning'}</>}
        </button>
        <button className={`big scan-pause ${p.running ? 'stop' : ''}`} onClick={p.onStop} disabled={!p.running}><Icon name="pause" size={16} />Pause</button>
      </div>

      {p.running && (
        <div className="live" role="status">
          <div className="live-top">
            <span className="pulse" />
            <span className="live-title">Scanning in progress</span>
          </div>
          <div className="live-status">{p.status.text}</div>
          <div className="progress"><i /></div>
          <div className="live-counts">
            <span><b>{p.found.toLocaleString('en-US')}</b> carriers found</span>
            <span><b>{p.checked.toLocaleString('en-US')}</b> MC numbers checked</span>
            {p.found > 0 && <button className="small primary" onClick={p.onViewResults}>View results ↓</button>}
          </div>
        </div>
      )}

      <div className="switches">
        <Switch
          label="Verify on SAFER (live)"
          checked={p.settings.useSafer}
          disabled={p.running}
          onChange={(v) => p.onSettings({ ...p.settings, useSafer: v })}
        />
        {FILTERS.map((f) => (
          <Switch key={f.key} label={f.label} checked={p.filters[f.key]} onChange={(v) => p.onFilters({ ...p.filters, [f.key]: v })} />
        ))}
      </div>

      <details className="advanced">
        <summary><Icon name="file" size={14} />Advanced settings</summary>
        <div className="controls">{ADVANCED_FIELDS.map(numberInput)}</div>
        <p className="rules">
          Always: carriers only (brokers are skipped), email required, AUTHORIZED only. With SAFER verification the
          authority status comes live from SAFER for every MC; without it, from the FMCSA files (L&amp;I + Motus).
        </p>
      </details>

      {!p.running && <div className={`status ${p.status.tone === 'error' ? 'error' : ''}`}>{p.status.text}</div>}
      {p.backendOk === false && <div className="status error">Server not reachable. Please reload the page in a minute.</div>}
    </div>
  )
}

/** iOS-style toggle built on a real checkbox (keyboard and screen readers work as usual). */
function Switch({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={`switch ${disabled ? 'disabled' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="track"><span className="thumb" /></span>
      {label}
    </label>
  )
}
