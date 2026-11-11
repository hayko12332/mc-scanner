import type { ScannedCarrier } from '../types'

const KEY = 'leadhaul.seen.v1'
/** Carriers granted longer ago than this are forgotten. */
const KEEP_DAYS = 45

/** Which New MC leads this browser has already loaded. */
export interface SeenLeads {
  /** MC number → grant date (YYYY-MM-DD). */
  mcs: Record<string, string>
  /** Earliest grant date any earlier load covered; older carriers were never in range, so they are not "new". */
  from: string
}

export function loadSeen(): SeenLeads {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as SeenLeads | null
    if (s && typeof s.mcs === 'object' && typeof s.from === 'string') return s
  } catch {
    // unreadable or blocked storage: start over
  }
  return { mcs: {}, from: '' }
}

/** True when the carrier showed up since this browser's previous load (never on a first visit). */
export function isNewSince(seen: SeenLeads, c: ScannedCarrier): boolean {
  return !!seen.from && !seen.mcs[c.mc] && (c.grantedOn ?? '') >= seen.from
}

/** Remembers the carriers of a finished load that covered grant dates from `from` on. */
export function rememberSeen(seen: SeenLeads, carriers: ScannedCarrier[], from: string) {
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10)
  const mcs: Record<string, string> = {}
  for (const [mc, granted] of Object.entries(seen.mcs)) if (granted >= cutoff) mcs[mc] = granted
  for (const c of carriers) if (c.grantedOn) mcs[c.mc] = c.grantedOn
  const earliest = seen.from && seen.from < from ? seen.from : from
  try {
    localStorage.setItem(KEY, JSON.stringify({ mcs, from: earliest < cutoff ? cutoff : earliest }))
  } catch {
    // storage full or blocked: everything simply looks new next time
  }
}
