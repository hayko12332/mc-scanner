import { useCallback, useRef, useState } from 'react'
import { api } from '../api'
import { carrierKey } from '../lib/carrier'
import { sleep } from '../lib/format'
import { verifyWithSafer } from '../lib/safer'
import type { ScannedCarrier } from '../types'

/** Stop after this many consecutive batches without census records: the end of the MC range. */
const MAX_EMPTY_BATCHES = 50

export interface ScanSettings {
  startMc: string
  endMc: string
  batchSize: string
  delayMs: string
  saferConcurrency: string
  useSafer: boolean
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
      : 'Ready. Enter an MC number and press Start.',
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
        say(`Searching MC ${mc}–${to}…`)

        const result = await api.scan(mc, to, settings.useSafer ? 'lenient' : 'strict', ctrl.signal)
        const batchSeen = new Set<string>()
        const fresh = result.carriers.filter((c) => {
          const key = carrierKey(c)
          if (seen.current.has(key) || batchSeen.has(key)) return false
          batchSeen.add(key)
          return true
        })
        let kept: ScannedCarrier[] = fresh
        if (settings.useSafer && fresh.length) {
          const { verified, rejected } = await verifyWithSafer(fresh, concurrency, ctrl.signal, say)
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
