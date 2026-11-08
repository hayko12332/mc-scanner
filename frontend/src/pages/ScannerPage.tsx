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
  startMc: '1',
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

  return (
    <>
      <p className="sub">
        Continuous carrier lookup by MC number (MC, MC+1, MC+2 …). Data: official FMCSA files (Company Census +
        Licensing &amp; Insurance) on data.transportation.gov, updated daily, with live SAFER verification.
      </p>

      <ScanPanel
        settings={settings}
        onSettings={setSettings}
        filters={filters}
        onFilters={setFilters}
        backendOk={backendOk}
        running={scanner.running}
        status={scanner.status}
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
  )
}
