import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ResultsTable } from '../components/ResultsTable'
import { CountUp, HeroNetwork } from '../components/HeroNetwork'
import { Icon } from '../components/Icon'
import { FeatureBento, HowItWorks } from '../components/Landing'
import { ScanPanel } from '../components/ScanPanel'
import { StatsBar } from '../components/StatsBar'
import { LeadsPanel } from '../components/LeadsPanel'
import { useLeads } from '../hooks/useLeads'
import { useReveal } from '../hooks/useReveal'
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
  const leads = useLeads()
  const [period, setPeriod] = useState(7)
  // "New MC leads" is the default mode: that is what dispatchers look for first.
  const [mode, setModeState] = useState<'leads' | 'range'>(() => {
    try { return localStorage.getItem('mcScanner.mode') === 'range' ? 'range' : 'leads' } catch { return 'leads' }
  })
  const setMode = (m: 'leads' | 'range') => {
    setModeState(m)
    try { localStorage.setItem('mcScanner.mode', m) } catch { /* storage blocked */ }
    track('mode', { mode: m })
  }
  // First-time visitors see what the tool does; returning users with saved results go straight to work.
  const [showHero] = useState(() => !saved.rows?.length && !leads.rows.length)
  useReveal([showHero])

  const { rows, checked, saferRejected, nextMc } = scanner
  useEffect(() => {
    saveState<SavedState>({ settings, filters, rows, checked, saferRejected, nextMc })
  }, [settings, filters, rows, checked, saferRejected, nextMc])

  const visible = useMemo(() => rows.filter((c) => passesFilters(c, filters)), [rows, filters])
  const leadsVisible = useMemo(() => leads.rows.filter((c) => passesFilters(c, filters)), [leads.rows, filters])
  const isLeads = mode === 'leads'
  const shown = isLeads ? leadsVisible : visible
  const runningNow = isLeads ? leads.running : scanner.running

  const startLeads = (days = period) => {
    track('leads_start', { days })
    void leads.start(days)
  }

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

  const started = isLeads ? leads.running || leads.rows.length > 0 : scanner.running || checked > 0 || rows.length > 0

  // When a run finds its first carrier, bring the results into view (they are below the fold on phones).
  const resultsRef = useRef<HTMLElement>(null)
  const runStartCount = useRef(0)
  const autoScrolled = useRef(false)
  useEffect(() => {
    if (!runningNow) return
    runStartCount.current = isLeads ? 0 : shown.length
    autoScrolled.current = false
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runningNow])
  useEffect(() => {
    if (!runningNow || autoScrolled.current || shown.length <= runStartCount.current) return
    autoScrolled.current = true
    const el = resultsRef.current
    if (el && el.getBoundingClientRect().top > innerHeight * 0.5) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [shown.length, runningNow])

  const startFromHero = () => {
    setMode('leads')
    document.getElementById('scanner')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    if (!leads.running && backendOk !== false) startLeads(7)
  }

  return (
    <>
      {showHero && (
        <section className="hero-band">
          <div className="hero wrap">
            <div className="hero-text">
              <a className="announce" href="#/feedback">
                <span className="announce-tag">New</span>
                Dispatcher CRM is coming — tell us what you need
                <Icon name="arrow" size={14} />
              </a>
              <h1>New MC leads <span className="hl">with phone &amp; email</span> every day</h1>
              <p className="hero-sub">
                Carriers that just got their operating authority — reach them before other dispatchers do. Or scan any
                MC range and verify carriers live on SAFER. Built for dispatchers and freight brokers.
              </p>
              <div className="hero-cta">
                <button className="primary big glow" onClick={startFromHero} disabled={backendOk === false}>
                  <Icon name="zap" size={16} />Get new MC leads
                </button>
                <a className="btn big ghost" href="#/lookup"><Icon name="search" size={17} />Check a company</a>
              </div>
              <ul className="trust">
                <li><Icon name="database" size={15} />Official FMCSA data</li>
                <li><Icon name="shield" size={15} />Live SAFER check</li>
                <li><Icon name="zap" size={15} />No sign-up</li>
              </ul>
            </div>
            <HeroNetwork />
          </div>
          <div className="wrap">
            <div className="hero-stats reveal">
              <div><span className="stat-icon"><Icon name="zap" /></span><b><CountUp to={150} suffix="+" /></b><span>new carriers every day</span></div>
              <div><span className="stat-icon"><Icon name="shield" /></span><b><CountUp to={100} suffix="%" /></b><span>carriers verified on SAFER</span></div>
              <div><span className="stat-icon"><Icon name="refresh" /></span><b>Daily</b><span>FMCSA census &amp; L&amp;I refresh</span></div>
              <div><span className="stat-icon"><Icon name="dollar" /></span><b>$<CountUp to={0} /></b><span>free, unlimited CSV export</span></div>
            </div>
          </div>
        </section>
      )}

      {showHero && <HowItWorks />}

      <section id="scanner" className="section-anchor">
        <div className="mode-tabs" role="tablist" aria-label="Mode">
          <button role="tab" aria-selected={isLeads} className={isLeads ? 'on' : ''} onClick={() => setMode('leads')}>
            <Icon name="zap" size={18} />
            <span><b>New MC leads <span className="new-tag">NEW</span></b><small>Carriers that just got authority</small></span>
          </button>
          <button role="tab" aria-selected={!isLeads} className={!isLeads ? 'on' : ''} onClick={() => setMode('range')}>
            <Icon name="scan" size={18} />
            <span><b>Scan MC range</b><small>Walk MC numbers one by one</small></span>
          </button>
        </div>
        {isLeads ? (
          <LeadsPanel
            period={period}
            onPeriod={setPeriod}
            filters={filters}
            onFilters={setFilters}
            running={leads.running}
            status={leads.status}
            done={leads.done}
            total={leads.total}
            found={leadsVisible.length}
            fetchedAt={leads.fetchedAt}
            onStart={() => startLeads()}
            onStop={leads.stop}
            onViewResults={() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          />
        ) : (
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
        onViewResults={() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        />
        )}
      </section>

      {started && (
        <section ref={resultsRef} id="results" className="section-anchor">
          <ResultsTable
            carriers={shown}
            running={runningNow}
            noun={isLeads ? 'new carrier' : 'carrier'}
            onCopy={(text) => copy(text)}
            onCsv={() => {
              if (!shown.length) return toast('No data')
              downloadCsv(shown)
              track('csv_export', { rows: shown.length, mode })
            }}
            onCopyEmails={() => copyAll(shown.map((c) => c.email), 'emails')}
            onCopyPhones={() => copyAll(shown.flatMap((c) => [c.phone, c.cellPhone]).filter(Boolean).map(formatPhone), 'phones')}
            onClear={() => confirm('Delete all found records?') && (isLeads ? leads.clear() : scanner.clear())}
          />
          {!isLeads && <StatsBar
            current={scanner.current}
            checked={checked}
            found={visible.length}
            withPhone={visible.filter((c) => c.phone || c.cellPhone).length}
            saferRejected={saferRejected}
            rate={scanner.rate}
          />}
        </section>
      )}

      {showHero && <FeatureBento />}
    </>
  )
}
