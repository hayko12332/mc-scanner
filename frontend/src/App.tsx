import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from './api'
import { ResultsTable } from './components/ResultsTable'
import { ScanPanel } from './components/ScanPanel'
import { StatsBar } from './components/StatsBar'
import { useScanner, type ScanProgress, type ScanSettings } from './hooks/useScanner'
import { useToast } from './hooks/useToast'
import { downloadCsv, passesFilters, type Filters } from './lib/carrier'
import { formatPhone } from './lib/format'
import { loadState, saveState } from './lib/storage'

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

export default function App() {
  const saved = useMemo(() => loadState<SavedState>(), [])
  const [settings, setSettings] = useState<ScanSettings>({ ...DEFAULT_SETTINGS, ...saved.settings })
  const [filters, setFilters] = useState<Filters>({ ...DEFAULT_FILTERS, ...saved.filters })
  const onAdvance = useCallback((mc: number) => setSettings((s) => ({ ...s, startMc: String(mc) })), [])
  const scanner = useScanner(saved, onAdvance)
  const toast = useToast()
  const [backendOk, setBackendOk] = useState<boolean | null>(null)

  useEffect(() => {
    api.health().then(() => setBackendOk(true), () => setBackendOk(false))
  }, [])

  const { rows, checked, saferRejected, nextMc } = scanner
  useEffect(() => {
    saveState<SavedState>({ settings, filters, rows, checked, saferRejected, nextMc })
  }, [settings, filters, rows, checked, saferRejected, nextMc])

  const visible = useMemo(() => rows.filter((c) => passesFilters(c, filters)), [rows, filters])

  const copy = useCallback(async (text: string, what = text) => {
    if (!text) return toast.show('Nothing to copy')
    try {
      await navigator.clipboard.writeText(text)
      toast.show(`Copied: ${what}`)
    } catch {
      toast.show('Could not copy')
    }
  }, [toast])

  const copyAll = (values: string[], noun: string) => {
    const unique = [...new Set(values.filter(Boolean))]
    void copy(unique.join('\n'), `${unique.length} ${noun}`)
  }

  return (
    <div className="wrap">
      <h1>MC Scanner — FMCSA</h1>
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
        onStart={() => void scanner.start(settings)}
        onStop={scanner.stop}
        onCsv={() => (visible.length ? downloadCsv(visible) : toast.show('No data'))}
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

      <ResultsTable carriers={visible} onCopy={(text) => void copy(text)} />

      <div className={`toast ${toast.message ? 'show' : ''}`}>{toast.message}</div>
    </div>
  )
}
