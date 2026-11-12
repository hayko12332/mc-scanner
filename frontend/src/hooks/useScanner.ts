import { useCallback, useRef, useState } from 'react'
import { api, ApiError } from '../api'
import { carrierKey } from '../lib/carrier'
import { sleep } from '../lib/format'
import { verifyWithSafer } from '../lib/safer'
import type { LeadKind, ScannedCarrier } from '../types'

/** Stop after this many consecutive batches without census records: the end of the MC range. */
const MAX_EMPTY_BATCHES = 50

export interface ScanSettings {
  startMc: string
  endMc: string
  batchSize: string
  delayMs: string
  saferConcurrency: string
  useSafer: boolean
  /** Carriers or brokers (older saved settings have no kind: carriers). */
  kind?: LeadKind
}

export interface ScanProgress {
  rows: ScannedCarrier[]
  checked: number
  saferRejected: number
  nextMc: number | null
}

export interface Status {
  text: string
  tone: 'info' | 'error'
}

const toInt = (value: string, fallback: number, min: number, max: number) => {
  const n = parseInt(value, 10)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}
const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError'
/** Lost connection or a server hiccup (restart, gateway timeout): worth trying again before stopping the scan. */
const isTransient = (e: unknown) => e instanceof ApiError && (e.status === 0 || e.status === 429 || e.status >= 500)
/** Waits between retries of one batch; after the last one the scan stops and can be continued. */
const RETRY_WAITS_MS = [3000, 8000, 20000]

/**
 * Walks MC numbers upward in batches: backend scan (census + FMCSA authority files) -> optional live
 * SAFER check per carrier. `onAdvance` reports the next MC so the start field can follow the scan.
 */
export function useScanner(initial: Partial<ScanProgress>, onAdvance: (nextMc: number) => void) {
  const [rows, setRows] = useState<ScannedCarrier[]>(initial.rows ?? [])
  const [checked, setChecked] = useState(initial.checked ?? 0)
  const [saferRejected, setSaferRejected] = useState(initial.saferRejected ?? 0)
  const [nextMc, setNextMc] = useState<number | null>(initial.nextMc ?? null)
  const [running, setRunning] = useState(false)
  const [current, setCurrent] = useState('—')
  const [rate, setRate] = useState(0)
  const [status, setStatus] = useState<Status>({
    text: initial.nextMc
      ? `Restored ${initial.rows?.length ?? 0} records. You can continue from MC ${initial.nextMc}.`
      : '',
    tone: 'info',
  })
  const seen = useRef(new Set((initial.rows ?? []).map(carrierKey)))
  const abort = useRef<AbortController | null>(null)

  const start = useCallback(async (settings: ScanSettings) => {
    const first = parseInt(settings.startMc, 10)
    if (!(first >= 1)) {
      setStatus({ text: 'Enter a valid start MC number.', tone: 'error' })
      return
    }
    const endValue = parseInt(settings.endMc, 10)
    const end = endValue >= 1 ? endValue : Infinity
    const batchSize = toInt(settings.batchSize, 100, 1, 200)
    const concurrency = toInt(settings.saferConcurrency, 3, 1, 10)
    const say = (text: string) => setStatus({ text, tone: 'info' })

    const ctrl = new AbortController()
    abort.current = ctrl
    setRunning(true)
    let mc = first
    let emptyStreak = 0
    let checkedThisRun = 0
    const startedAt = performance.now()
    let final: Status

    try {
      for (;;) {
        if (mc > end) {
          final = { text: `Done: reached MC ${end}.`, tone: 'info' }
          break
        }
        const to = Math.min(end, mc + batchSize - 1)
        setCurrent(`MC-${mc} … MC-${to}`)
        say(`Checking MC ${mc} – ${to} in FMCSA records…`)

        let result
        for (let attempt = 0; ; attempt++) {
          try {
            result = await api.scan(mc, to, settings.useSafer ? 'lenient' : 'strict', settings.kind ?? 'carrier', ctrl.signal)
            break
          } catch (e) {
            if (!isTransient(e) || attempt >= RETRY_WAITS_MS.length) throw e
            const wait = RETRY_WAITS_MS[attempt]
            say(`${(e as Error).message} — trying MC ${mc} – ${to} again in ${wait / 1000} s (attempt ${attempt + 2} of ${RETRY_WAITS_MS.length + 1})…`)
            await sleep(wait, ctrl.signal)
          }
        }
        const batchSeen = new Set<string>()
        const fresh = result.carriers.filter((c) => {
          const key = carrierKey(c)
          if (seen.current.has(key) || batchSeen.has(key)) return false
          batchSeen.add(key)
          return true
        })
        let kept: ScannedCarrier[] = fresh
        if (settings.useSafer && fresh.length) {
          const { verified, rejected } = await verifyWithSafer(fresh, concurrency, ctrl.signal, say, settings.kind ?? 'carrier')
          kept = verified
          setSaferRejected((n) => n + rejected)
        }

        kept.forEach((c) => seen.current.add(carrierKey(c)))
        setRows((prev) => [...prev, ...kept])
        const count = to - mc + 1
        setChecked((n) => n + count)
        checkedThisRun += count
        mc = to + 1
        setNextMc(mc)
        onAdvance(mc)
        setRate(Math.round(checkedThisRun / ((performance.now() - startedAt) / 1000)))

        emptyStreak = result.censusRecords ? 0 : emptyStreak + 1
        if (emptyStreak >= MAX_EMPTY_BATCHES) {
          final = {
            text: `${MAX_EMPTY_BATCHES * batchSize} MC numbers in a row without records — probably the end of the range. Stopped at MC ${mc}.`,
            tone: 'info',
          }
          break
        }
        const delay = toInt(settings.delayMs, 0, 0, 60_000)
        if (delay) await sleep(delay, ctrl.signal)
      }
    } catch (e) {
      final = isAbort(e)
        ? { text: `Paused. Next MC: ${mc}.`, tone: 'info' }
        : { text: `Stopped at MC ${mc}: ${(e as Error).message}. Press Start to continue.`, tone: 'error' }
    } finally {
      abort.current = null
      setRunning(false)
    }
    setStatus(final)
  }, [onAdvance])

  const stop = useCallback(() => abort.current?.abort(), [])

  const clear = useCallback(() => {
    setRows([])
    setChecked(0)
    setSaferRejected(0)
    setNextMc(null)
    setCurrent('—')
    setRate(0)
    seen.current = new Set()
    setStatus({ text: 'Cleared.', tone: 'info' })
  }, [])

  return { rows, checked, saferRejected, nextMc, running, current, rate, status, start, stop, clear }
}
