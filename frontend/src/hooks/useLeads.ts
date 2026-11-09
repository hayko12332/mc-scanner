import { useCallback, useRef, useState } from 'react'
import { api } from '../api'
import type { ScannedCarrier } from '../types'
import type { Status } from './useScanner'

const KEY = 'mcScanner.leads.v1'
/** Days fetched in parallel (each day is one backend request, ~10 s when not cached). */
const PARALLEL = 3

interface Saved {
  rows: ScannedCarrier[]
  days: number
  fetchedAt: string
}

function load(): Partial<Saved> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Saved>
  } catch {
    return {}
  }
}

function save(state: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    // storage blocked or full: leads still work, they just are not kept after a reload
  }
}

/** YYYY-MM-DD for `daysAgo` days before today (UTC, like the FMCSA files). */
export const isoDay = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10)

const byNewest = (a: ScannedCarrier, b: ScannedCarrier) =>
  (b.grantedOn ?? '').localeCompare(a.grantedOn ?? '') || a.legalName.localeCompare(b.legalName)

/**
 * "New MC leads": carriers granted operating authority in the last N days, newest first.
 * Days are loaded a few at a time and results appear as each day arrives.
 */
export function useLeads() {
  const saved = useRef(load()).current
  const [rows, setRows] = useState<ScannedCarrier[]>(saved.rows ?? [])
  const [days, setDays] = useState(saved.days ?? 0)
  const [fetchedAt, setFetchedAt] = useState(saved.fetchedAt ?? '')
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(0)
  const [total, setTotal] = useState(0)
  const [status, setStatus] = useState<Status>({ text: '', tone: 'info' })
  const abort = useRef<AbortController | null>(null)

  const start = useCallback(async (n: number) => {
    abort.current?.abort()
    const ctrl = new AbortController()
    abort.current = ctrl
    const dates = Array.from({ length: n }, (_, i) => isoDay(i))
    const found = new Map<number, ScannedCarrier>()
    setRows([])
    setDays(n)
    setDone(0)
    setTotal(n)
    setRunning(true)
    setStatus({ text: `Loading carriers that got their authority in the last ${n} days…`, tone: 'info' })
    let failed = 0
    let next = 0
    const worker = async () => {
      while (next < dates.length && !ctrl.signal.aborted) {
        const date = dates[next++]
        try {
          const day = await api.newLeads(date, ctrl.signal)
          for (const c of day.carriers) found.set(c.mc, c)
          setRows([...found.values()].sort(byNewest))
        } catch {
          if (ctrl.signal.aborted) return
          failed++
        }
        setDone((d) => d + 1)
      }
    }
    await Promise.all(Array.from({ length: PARALLEL }, worker))
    abort.current = null
    setRunning(false)
    if (ctrl.signal.aborted) return
    const list = [...found.values()].sort(byNewest)
    const at = new Date().toISOString()
    setFetchedAt(at)
    save({ rows: list, days: n, fetchedAt: at })
    setStatus(failed
      ? { text: `Loaded with ${failed} day(s) missing — FMCSA did not answer. Press the button again to retry.`, tone: 'error' }
      : { text: `${list.length.toLocaleString('en-US')} new carriers from the last ${n} days.`, tone: 'info' })
  }, [])

  const stop = useCallback(() => {
    abort.current?.abort()
    setRunning(false)
    setStatus({ text: 'Stopped.', tone: 'info' })
  }, [])

  const clear = useCallback(() => {
    setRows([])
    setDays(0)
    setFetchedAt('')
    save({ rows: [], days: 0, fetchedAt: '' })
    setStatus({ text: '', tone: 'info' })
  }, [])

  return { rows, days, fetchedAt, running, done, total, status, start, stop, clear }
}
