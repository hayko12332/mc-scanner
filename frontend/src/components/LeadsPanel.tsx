import type { Status } from '../hooks/useScanner'
import type { Filters } from '../lib/carrier'
import type { LeadKind } from '../types'
import { Icon } from './Icon'

export const PERIODS = [1, 3, 7, 14, 30] as const

/** Carriers / Brokers segmented switch, shared by New leads and the scanner. */
export function KindSwitch({ kind, onKind, disabled }: { kind: LeadKind; onKind: (k: LeadKind) => void; disabled?: boolean }) {
  return (
    <div className="kind-switch" role="radiogroup" aria-label="Find">
      {([['carrier', 'Carriers', 'Trucking companies — need a dispatcher'], ['broker', 'Brokers', 'Freight brokers — have loads for carriers']] as const)
        .map(([id, label, hint]) => (
          <button key={id} type="button" role="radio" aria-checked={kind === id} className={kind === id ? 'on' : ''} disabled={disabled} onClick={() => onKind(id)}>
            <b>{label}</b><small>{hint}</small>
          </button>
        ))}
    </div>
  )
}

interface Props {
  kind: LeadKind
  onKind: (k: LeadKind) => void
  period: number
  onPeriod: (days: number) => void
  filters: Filters
  onFilters: (f: Filters) => void
  running: boolean
  status: Status
  done: number
  total: number
  found: number
  fetchedAt: string
  onStart: () => void
  onStop: () => void
  onViewResults: () => void
}

/** "New MC leads": carriers that just got operating authority, by period. */
export function LeadsPanel(p: Props) {
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0
  const broker = p.kind === 'broker'
  const many = broker ? 'brokers' : 'carriers'
  return (
    <div className="panel scan-panel leads-panel">
      <div className="scan-head">
        <div className="tile-icon leads-icon"><Icon name="zap" /></div>
        <div className="scan-title">
          <h2>{broker ? 'New brokers' : 'New MC leads'} <span className="new-tag">NEW</span></h2>
          <p>{broker
            ? 'Freight brokers that just got their broker authority — new shippers’ loads, looking for carriers. Updated daily from FMCSA.'
            : 'Carriers that just got their operating authority — no dispatcher yet. Updated daily from FMCSA.'}</p>
        </div>
      </div>

      <KindSwitch kind={p.kind} onKind={p.onKind} disabled={p.running} />

      <div className="leads-row">
        <div className="period-picker" role="radiogroup" aria-label="Authority granted in the last">
          <span className="period-label">Granted in the last</span>
          {PERIODS.map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={p.period === d}
              className={p.period === d ? 'on' : ''}
              disabled={p.running}
              onClick={() => p.onPeriod(d)}
              title={d === 1 ? `Granted today and yesterday — FMCSA adds most of a day’s new ${many} on the next day` : undefined}
            >
              {d === 1 ? 'Latest' : `${d} days`}
            </button>
          ))}
        </div>
        <button className={`primary big glow scan-go ${p.running ? 'busy' : ''}`} onClick={p.onStart} disabled={p.running}>
          {p.running ? <><span className="spinner" /> Loading…</> : <><Icon name="zap" size={16} />Get new leads</>}
        </button>
        <button className={`big scan-pause ${p.running ? 'stop' : ''}`} onClick={p.onStop} disabled={!p.running}>
          <Icon name="pause" size={16} />Stop
        </button>
      </div>

      {p.running && (
        <div className="live" role="status">
          <div className="live-top"><span className="pulse" /><span className="live-title">Loading new {many}</span></div>
          <div className="live-status">{p.status.text}</div>
          <div className="progress determinate"><i style={{ width: `${Math.max(4, pct)}%` }} /></div>
          <div className="live-counts">
            <span><b>{p.found.toLocaleString('en-US')}</b> new {many} found</span>
            <span><b>{p.done}</b> of {p.total} {p.total === 1 ? "day" : "days"} loaded</span>
            {p.found > 0 && <button className="small primary" onClick={p.onViewResults}>View leads ↓</button>}
          </div>
        </div>
      )}

      <div className="switches">
        <Toggle label="With phone only" checked={p.filters.onlyWithPhone} onChange={(v) => p.onFilters({ ...p.filters, onlyWithPhone: v })} />
        {!broker && <Toggle label="Skip carrier + broker" checked={p.filters.skipCarrierBroker} onChange={(v) => p.onFilters({ ...p.filters, skipCarrierBroker: v })} />}
      </div>

      {!p.running && p.status.text && <div className={`status ${p.status.tone === 'error' ? 'error' : ''}`}>{p.status.text}</div>}
      {!p.running && !p.status.text && p.fetchedAt && (
        <div className="status">Last loaded {new Date(p.fetchedAt).toLocaleString()}. Press “Get new leads” to refresh.</div>
      )}
    </div>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="track"><span className="thumb" /></span>
      {label}
    </label>
  )
}
