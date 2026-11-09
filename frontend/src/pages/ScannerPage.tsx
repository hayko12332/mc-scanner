import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ResultsTable } from '../components/ResultsTable'
import { ScanPanel } from '../components/ScanPanel'
import { StatsBar } from '../components/StatsBar'
import { useScanner, type ScanProgress, type ScanSettings } from '../hooks/useScanner'
import { track } from '../lib/analytics'
import { downloadCsv, passesFilters, type Filters } from '../lib/carrier'
import { formatPhone } from '../lib/format'
import { loadState, saveState } from '../lib/storage'

interface SavedState extends ScanProgress {
  settings: ScanSettings
  filters: Filters
}

const DEFAULT_SETTINGS: ScanSettings = {
  startMc: '1000000',
  endMc: '',
  batchSize: '100',
  delayMs: '300',
  saferConcurrency: '3',
  useSafer: true,
}
const DEFAULT_FILTERS: Filters = { skipCarrierBroker: true, onlyActive: true, onlyWithPhone: true }

interface Props {
  backendOk: boolean | null
  copy: (text: string, what?: string) => void
  toast: (message: string) => void
}

export function ScannerPage({ backendOk, copy, toast }: Props) {
  const saved = useMemo(() => loadState<SavedState>(), [])
  const [settings, setSettings] = useState<ScanSettings>({ ...DEFAULT_SETTINGS, ...saved.settings })
  const [filters, setFilters] = useState<Filters>({ ...DEFAULT_FILTERS, ...saved.filters })
  const onAdvance = useCallback((mc: number) => setSettings((s) => ({ ...s, startMc: String(mc) })), [])
  const scanner = useScanner(saved, onAdvance)
  // First-time visitors see what the tool does; returning users with saved results go straight to work.
  const [showHero] = useState(() => !saved.rows?.length)

  const { rows, checked, saferRejected, nextMc } = scanner
  useEffect(() => {
    saveState<SavedState>({ settings, filters, rows, checked, saferRejected, nextMc })
  }, [settings, filters, rows, checked, saferRejected, nextMc])

  const visible = useMemo(() => rows.filter((c) => passesFilters(c, filters)), [rows, filters])

  const copyAll = (values: string[], noun: string) => {
    const unique = [...new Set(values.filter(Boolean))]
    copy(unique.join('\n'), `${unique.length} ${noun}`)
    track('copy_all', { what: noun, count: unique.length })
  }

  // Record how each scan ended (done, paused, error) once it stops running.
  const wasRunning = useRef(false)
  useEffect(() => {
    if (wasRunning.current && !scanner.running) {
      track('scan_end', { status: scanner.status.text.slice(0, 120), checked, found: visible.length })
    }
    wasRunning.current = scanner.running
  }, [scanner.running, scanner.status.text, checked, visible.length])

  const start = () => {
    track('scan_start', {
      from: settings.startMc, to: settings.endMc || null, batch: settings.batchSize, safer: settings.useSafer,
    })
    void scanner.start(settings)
  }

  const started = scanner.running || checked > 0 || rows.length > 0

  const startFromHero = () => {
    document.getElementById('scanner')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    if (!scanner.running && backendOk !== false) start()
  }

  return (
    <>
      {showHero && (
        <section className="hero">
          <div>
            <div className="badge-row">
              <span className="badge">Free</span>
              <span className="badge">No sign-up</span>
              <span className="badge">Official FMCSA data</span>
            </div>
            <h1>Find authorized trucking carriers <span className="hl">with phone &amp; email</span></h1>
            <p className="hero-sub">
              Scan MC numbers and get a ready list of active carriers, each verified live on SAFER. Built for
              dispatchers and freight brokers.
            </p>
            <div className="hero-cta">
              <button className="primary big" onClick={startFromHero} disabled={backendOk === false}>▶ Start free scan</button>
              <a className="btn big" href="#/lookup">🔎 Check a company</a>
            </div>
            <div className="trust">
              <span>Updated daily</span>
              <span>Live SAFER check</span>
              <span>Export to CSV</span>
            </div>
          </div>
          <ResultPreview />
        </section>
      )}

      {showHero && (
        <section className="section">
          <div className="section-head">
            <h2>How it works</h2>
            <p>From an MC number to a call list in under a minute.</p>
          </div>
          <div className="steps">
            <div className="step">
              <div className="step-num">1</div>
              <h3>Pick a starting MC</h3>
              <p>Enter any MC number, or keep the default. The scanner checks MC, MC+1, MC+2 and so on.</p>
            </div>
            <div className="step">
              <div className="step-num">2</div>
              <h3>Press Start</h3>
              <p>Only authorized carriers with a phone and email are kept, each re-checked on SAFER live.</p>
            </div>
            <div className="step">
              <div className="step-num">3</div>
              <h3>Call or export</h3>
              <p>Click a phone or email to copy it, copy them all in one click, or download a CSV.</p>
            </div>
          </div>
        </section>
      )}

      <section id="scanner" className="section-anchor">
        <ScanPanel
        settings={settings}
        onSettings={setSettings}
        filters={filters}
        onFilters={setFilters}
        backendOk={backendOk}
        running={scanner.running}
        status={scanner.status}
        hasResults={rows.length > 0}
        found={visible.length}
        checked={checked}
        onStart={start}
        onStop={scanner.stop}
        onCsv={() => {
          if (!visible.length) return toast('No data')
          downloadCsv(visible)
          track('csv_export', { rows: visible.length })
        }}
        onCopyEmails={() => copyAll(visible.map((c) => c.email), 'emails')}
        onCopyPhones={() => copyAll(visible.flatMap((c) => [c.phone, c.cellPhone]).filter(Boolean).map(formatPhone), 'phones')}
        onClear={() => confirm('Delete all found records?') && scanner.clear()}
        />

        {started && (
          <>
            <StatsBar
              current={scanner.current}
              checked={checked}
              found={visible.length}
              withPhone={visible.filter((c) => c.phone || c.cellPhone).length}
              saferRejected={saferRejected}
              rate={scanner.rate}
            />
            <ResultsTable carriers={visible} running={scanner.running} onCopy={(text) => copy(text)} />
          </>
        )}
      </section>

      {showHero && (
        <section className="section">
          <div className="section-head">
            <h2>Everything you need to vet a carrier</h2>
            <p>One free tool instead of a dozen tabs with SAFER, L&amp;I and state registries.</p>
          </div>
          <div className="features">
            {FEATURES.map(([icon, title, text]) => (
              <div key={title} className="feature">
                <div className="feature-icon">{icon}</div>
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  )
}

const FEATURES: [string, string, string][] = [
  ['🔁', 'MC scanner', 'Walks MC numbers one by one and keeps only authorized carriers (no brokers) with a phone and email.'],
  ['✅', 'Live SAFER check', 'Every carrier is re-checked on SAFER in real time, so you don’t call companies whose authority is gone.'],
  ['🔎', 'Company lookup', 'Check any company by MC, USDOT, email or phone: authority, fleet, cargo and related companies.'],
  ['🛡️', 'Insurance & records', 'Active insurance and policy history, state business registration, UCC liens and court links.'],
  ['⬇️', 'Copy & export', 'Copy all phones or emails in one click, or download a CSV for your CRM or dialer.'],
  ['🤖', 'Telegram bot', 'The same scanner and lookup inside Telegram — open it from @MCUSDOTScannerbot.'],
]

/** Illustration of a scan result for first-time visitors; contacts are masked on purpose. */
function ResultPreview() {
  const rows = [
    ['B•••• Express LLC', 'MC-1000012', 'TX · 6 trucks', '(214) •••-••37', 'dispatch@••••.com'],
    ['S•••• Trucking Inc', 'MC-1000047', 'IL · 3 trucks', '(773) •••-••91', 'ops@••••.com'],
    ['M•••• Logistics LLC', 'MC-1000083', 'GA · 12 trucks', '(404) •••-••15', 'info@••••.com'],
  ]
  return (
    <div className="preview" aria-label="Example of a scan result">
      <div className="preview-head">
        <div className="dots"><i /><i /><i /></div>
        <b>Example result</b>
        <span className="muted">200 MCs → 31 carriers</span>
      </div>
      {rows.map(([name, mc, meta, phone, email]) => (
        <div key={mc} className="preview-row">
          <div>
            <div className="preview-name">{name}</div>
            <div className="preview-meta">{mc} · {meta}</div>
          </div>
          <div><span className="pill pill-ok">AUTHORIZED ✓ SAFER</span></div>
          <div className="preview-contacts">
            <span>📞 {phone}</span>
            <span>✉️ {email}</span>
          </div>
        </div>
      ))}
      <div className="preview-foot">Contacts are hidden in this example. Run a scan to see real ones.</div>
    </div>
  )
}
