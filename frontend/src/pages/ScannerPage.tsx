import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ResultsTable } from '../components/ResultsTable'
import { SheetsDialog } from '../components/SheetsDialog'
import { Icon } from '../components/Icon'
import { ScanPanel } from '../components/ScanPanel'
import { StatsBar } from '../components/StatsBar'
import { LeadsPanel } from '../components/LeadsPanel'
import { useLeads } from '../hooks/useLeads'
import { useScanner, type ScanProgress, type ScanSettings } from '../hooks/useScanner'
import { track } from '../lib/analytics'
import { passesFilters, type Filters } from '../lib/carrier'
import { copyForSheets, downloadCsv, downloadVcf, downloadXlsx, onExportNotice, printCallSheet } from '../lib/export'
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
  /** Which tool is shown: New MC leads or the MC range scanner. */
  mode: 'leads' | 'range'
  /** Current hash; "#/leads?go=1" starts loading leads for 7 days. */
  hash: string
  /** Changes on every navigation, so the same "?go" link works twice. */
  navKey: number
  backendOk: boolean | null
  copy: (text: string, what?: string) => void
  toast: (message: string) => void
}

/** The two tools (New MC leads and the MC range scanner) with their results; both keep running in the background. */
export function ScannerPage({ mode, hash, navKey, backendOk, copy, toast }: Props) {
  const saved = useMemo(() => loadState<SavedState>(), [])
  const [settings, setSettings] = useState<ScanSettings>({ ...DEFAULT_SETTINGS, ...saved.settings })
  const [filters, setFilters] = useState<Filters>({ ...DEFAULT_FILTERS, ...saved.filters })
  const onAdvance = useCallback((mc: number) => setSettings((s) => ({ ...s, startMc: String(mc) })), [])
  const scanner = useScanner(saved, onAdvance)
  const leads = useLeads()
  // The period of the leads on screen (kept across reloads), else one day.
  const [period, setPeriod] = useState(leads.days || 1)
  /** Google Sheets dialog: rows copied, or null when closed. */
  const [sheets, setSheets] = useState<{ rows: number; copied: boolean } | null>(null)
  useEffect(() => onExportNotice(toast), [toast])

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

  // "#/leads?go=1" (the landing page button) starts loading leads right away.
  useEffect(() => {
    const go = parseInt(new URLSearchParams(hash.split('?')[1] ?? '').get('go') ?? '', 10)
    if (mode !== 'leads' || !Number.isFinite(go)) return
    history.replaceState(null, '', '#/leads')
    if (leads.running || backendOk === false) return
    setPeriod(go)
    startLeads(go)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navKey])

  return (
    <>
      <section id="scanner" className="section-anchor tools">
        <div className="mode-tabs" role="tablist" aria-label="Mode">
          <a href="#/leads" role="tab" aria-selected={isLeads} className={isLeads ? 'on' : ''}>
            <Icon name="zap" size={18} />
            <span><b>New MC leads <span className="new-tag">NEW</span></b><small>Carriers that just got authority</small></span>
          </a>
          <a href="#/scan" role="tab" aria-selected={!isLeads} className={!isLeads ? 'on' : ''}>
            <Icon name="scan" size={18} />
            <span><b>Scan MC range</b><small>Walk MC numbers one by one</small></span>
          </a>
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
            onExport={(format) => {
              if (!shown.length) return toast('No data')
              track('csv_export', { rows: shown.length, mode, format })
              if (format === 'xlsx') downloadXlsx(shown)
              else if (format === 'csv') downloadCsv(shown)
              else if (format === 'vcf') downloadVcf(shown)
              else if (format === 'print') printCallSheet(shown)
              else copyForSheets(shown).then(
                () => setSheets({ rows: shown.length, copied: true }),
                () => setSheets({ rows: shown.length, copied: false }),
              )
            }}
            fresh={isLeads ? leads.fresh : undefined}
            onCopyList={(kind, list) => kind === 'emails'
              ? copyAll(list.map((c) => c.email), 'new emails')
              : copyAll(list.flatMap((c) => [c.phone, c.cellPhone]).filter(Boolean).map(formatPhone), 'new phones')}
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
      {sheets && (
        <SheetsDialog
          {...sheets}
          onClose={() => setSheets(null)}
          onCopyAgain={() => copyForSheets(shown).then(() => toast('Copied again'), () => setSheets({ rows: shown.length, copied: false }))}
          onDownload={(f) => { track('csv_export', { rows: shown.length, mode, format: f, from: 'sheets' }); (f === 'xlsx' ? downloadXlsx : downloadCsv)(shown); setSheets(null) }}
        />
      )}

    </>
  )
}
