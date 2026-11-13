import { useCallback, useRef, useState } from 'react'
import { api } from '../api'
import { isNewSince, loadSeen, rememberSeen } from '../lib/seenLeads'
import posthog, { isPostHogConfigured } from '../lib/posthog'
import { KIND_NOUN, type LeadKind, type ScannedCarrier } from '../types'
import type { Status } from './useScanner'

const KEYS: Record<LeadKind, string> = { carrier: 'mcScanner.leads.v1', broker: 'leadhaul.brokerLeads.v1' }
/** Days fetched in parallel (each day is one small request; the server keeps the last month ready). */
const PARALLEL = 6

interface Saved {
  rows: ScannedCarrier[]
  /** MC numbers that were new since the load before this one. */
  fresh?: number[]
  days: number
  fetchedAt: string
}

function load(kind: LeadKind): Partial<Saved> {
  try {
    return JSON.parse(localStorage.getItem(KEYS[kind]) ?? '{}') as Partial<Saved>
  } catch {
    return {}
  }
}

function save(kind: LeadKind, state: Saved) {
  try {
    localStorage.setItem(KEYS[kind], JSON.stringify(state))
  } catch {
    // storage blocked or full: leads still work, they just are not kept after a reload
  }
}

/** YYYY-MM-DD for `daysAgo` days before today in US Eastern time, the calendar FMCSA dates its grants by. */
export const isoDay = (daysAgo: number) =>
  new Date(Date.now() - daysAgo * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

const dayWord = (n: number) => (n === 1 ? 'today and yesterday' : `the last ${n} days`)
/** "Latest" keeps going back a day while it has fewer than this (FMCSA posts most grants the next morning). */
const LATEST_MIN: Record<LeadKind, number> = { carrier: 50, broker: 5 }

const byNewest = (a: ScannedCarrier, b: ScannedCarrier) =>
  (b.grantedOn ?? '').localeCompare(a.grantedOn ?? '') || a.legalName.localeCompare(b.legalName)

/** Carriers not seen in this browser's previous loads first, then newest grant date first. */
const sortLeads = (list: Iterable<ScannedCarrier>, fresh: Set<number>) =>
  [...list].sort((a, b) => Number(fresh.has(b.mc)) - Number(fresh.has(a.mc)) || byNewest(a, b))

/**
 * "New MC leads": carriers granted operating authority in the last N days, newest first.
 * Days are loaded a few at a time and results appear as each day arrives.
 */
export function useLeads(kind: LeadKind = 'carrier') {
  const [one, many] = KIND_NOUN[kind]
  const saved = useRef(load(kind)).current
  const [rows, setRows] = useState<ScannedCarrier[]>(saved.rows ?? [])
  const [fresh, setFresh] = useState<Set<number>>(() => new Set(saved.fresh ?? []))
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
    // "Latest" (n = 1) is today plus yesterday: FMCSA adds most of a day's grants on the following day.
    const dates = Array.from({ length: n === 1 ? 2 : n }, (_, i) => isoDay(i))
    const found = new Map<number, ScannedCarrier>()
    // What this browser had already loaded before; anything else that falls in that date range is new to the user.
    const seen = loadSeen(load(kind).rows, kind)
    const freshNow = new Set<number>()
    // Days arrive within milliseconds of each other: draw the list at most every 300 ms instead of once per day.
    let timer: ReturnType<typeof setTimeout> | null = null
    const flush = () => {
      if (timer) clearTimeout(timer)
      timer = null
      setFresh(new Set(freshNow))
      setRows(sortLeads(found.values(), freshNow))
    }
    const add = (carriers: ScannedCarrier[]) => {
      for (const c of carriers) {
        found.set(c.mc, c)
        if (isNewSince(seen, c)) freshNow.add(c.mc)
      }
      if (!timer) timer = setTimeout(flush, found.size ? 300 : 0)
    }
    setRows([])
    setFresh(new Set())
    setDays(n)
    setDone(0)
    setTotal(dates.length)
    setRunning(true)
    setStatus({ text: `Loading ${many} that got their authority ${n === 1 ? '' : 'in '}${dayWord(n)}…`, tone: 'info' })
    let failed = 0
    let partial = 0
    let next = 0
    const worker = async () => {
      while (next < dates.length && !ctrl.signal.aborted) {
        const date = dates[next++]
        try {
          const day = await api.newLeads(date, kind, ctrl.signal)
          if (day.partial) partial++
          add(day.carriers)
        } catch {
          if (ctrl.signal.aborted) return
          failed++
        }
        setDone((d) => d + 1)
      }
    }
    await Promise.all(Array.from({ length: PARALLEL }, worker))
    flush()
    // "Latest" early in the morning: FMCSA has few or none of today's and yesterday's grants yet, so it also shows
    // the days before, until the list is worth calling (at most 4 days back).
    let extraDays = 0
    for (let back = 2; n === 1 && found.size < LATEST_MIN[kind] && !failed && back <= 4 && !ctrl.signal.aborted; back++) {
      extraDays++
      try {
        add((await api.newLeads(isoDay(back), kind, ctrl.signal)).carriers)
      } catch {
        if (!ctrl.signal.aborted) failed++
      }
    }
    flush()
    abort.current = null
    setRunning(false)
    if (ctrl.signal.aborted) return
    const list = sortLeads(found.values(), freshNow)
    const at = new Date().toISOString()
    setFetchedAt(at)
    save(kind, { rows: list, fresh: [...freshNow], days: n, fetchedAt: at })
    const span = extraDays ? `the last ${2 + extraDays} days` : dayWord(n)
    if (!failed) rememberSeen(seen, list, extraDays ? isoDay(1 + extraDays) : dates[dates.length - 1], kind)
    if (isPostHogConfigured()) {
      const logAttributes = {
        kind,
        requested_days: n,
        extra_days: extraDays,
        result_count: list.length,
        new_result_count: freshNow.size,
        failed_day_count: failed,
        partial_day_count: partial,
      }
      posthog.capture('lead_search_completed', logAttributes)
      if (failed || partial) {
        posthog.logger.warn('lead_search_completed', logAttributes)
      } else {
        posthog.logger.info('lead_search_completed', logAttributes)
      }
    }
    setStatus(failed
      ? { text: `Loaded with ${failed} day(s) missing — FMCSA did not answer. Press the button again to retry.`, tone: 'error' }
      : partial
        ? { text: `${list.length.toLocaleString('en-US')} new ${list.length === 1 ? one : many} from ${span}. FMCSA’s contact file is not answering right now, so emails are missing for ${partial} day(s) — phone and address are shown. Try again later for emails.`, tone: 'error' }
        : { text: `${list.length.toLocaleString('en-US')} new ${list.length === 1 ? one : many} from ${span}.${extraDays ? ' FMCSA hasn’t posted most of today’s and yesterday’s grants yet, so earlier days are included.' : ''}`, tone: 'info' })
  }, [kind, one, many])

  const stop = useCallback(() => {
    abort.current?.abort()
    setRunning(false)
    setStatus({ text: 'Stopped.', tone: 'info' })
  }, [])

  const clear = useCallback(() => {
    setRows([])
    setFresh(new Set())
    setDays(0)
    setFetchedAt('')
    save(kind, { rows: [], days: 0, fetchedAt: '' })
    setStatus({ text: '', tone: 'info' })
  }, [kind])

  return { rows, fresh, days, fetchedAt, running, done, total, status, start, stop, clear }
}
