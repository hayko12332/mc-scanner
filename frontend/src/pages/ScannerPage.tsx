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

  return (
    <>
      {showHero && (
        <section className="hero">
          <h2>Find authorized trucking carriers with phone &amp; email</h2>
          <p className="hero-sub">Free FMCSA carrier lookup for dispatchers and brokers. No sign-up.</p>
          <ul className="hero-points">
            <li><b>Scans MC numbers in a row</b> (MC, MC+1, MC+2 …) and keeps only authorized carriers</li>
            <li><b>Live SAFER check</b> of every carrier it finds</li>
            <li><b>Copy all phones and emails</b> in one click or download CSV</li>
          </ul>
          <p className="hero-data">
            Data: official FMCSA files (Company Census, Licensing &amp; Insurance), updated daily.
          </p>
        </section>
      )}

      <ScanPanel
        settings={settings}
        onSettings={setSettings}
        filters={filters}
        onFilters={setFilters}
        backendOk={backendOk}
        running={scanner.running}
        status={scanner.status}
        hasResults={rows.length > 0}
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

      {started ? (
        <>
          <StatsBar
            current={scanner.current}
            checked={checked}
            found={visible.length}
            withPhone={visible.filter((c) => c.phone || c.cellPhone).length}
            saferRejected={saferRejected}
            rate={scanner.rate}
          />
          <ResultsTable carriers={visible} onCopy={(text) => copy(text)} />
        </>
      ) : (
        <div className="panel how">
          <h3>How it works</h3>
          <ol>
            <li><b>Pick a starting MC</b> or keep the one above.</li>
            <li><b>Press Start scanning.</b> Carriers with phone and email show up here as they are found.</li>
            <li><b>Click any phone or email to copy it</b>, or copy them all / download CSV.</li>
          </ol>
          <p className="muted">
            Need to check one company? Use <a href="#/lookup">Lookup</a> by MC, USDOT, email or phone: authority,
            insurance, fleet and state registration.
          </p>
        </div>
      )}
    </>
  )
}
