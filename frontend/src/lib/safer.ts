import { api, ApiError } from '../api'
import type { Carrier, SaferSnapshot, ScannedCarrier, LeadKind } from '../types'
import { sleep } from './format'

const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname)

async function countdown(seconds: number, message: string, signal: AbortSignal, onStatus: (text: string) => void) {
  const hint = isLocal ? ' If this never clears on a local run, make sure a US VPN is on.' : ''
  for (let s = seconds; s > 0; s--) {
    onStatus(`${message} Resuming automatically in ${s} s…${hint}`)
    await sleep(1000, signal)
  }
}

/** One SAFER lookup; waits out rate-limit pauses for as long as it takes, retries other errors a few times. */
export async function checkSafer(mc: number, signal: AbortSignal, onStatus: (text: string) => void): Promise<SaferSnapshot> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await api.safer(mc, signal)
    } catch (e) {
      if (signal.aborted) throw e
      if (e instanceof ApiError && e.retryAfter) {
        await countdown(e.retryAfter, e.message, signal, onStatus)
        attempt = -1
        continue
      }
      if (attempt >= 3) throw e
      await sleep(1000 * 2 ** attempt, signal)
    }
  }
}

/** Keep only carriers SAFER shows as AUTHORIZED FOR a Motor Carrier authority under the same USDOT number. */
export async function verifyWithSafer(
  candidates: Carrier[],
  concurrency: number,
  signal: AbortSignal,
  onStatus: (text: string) => void,
  kind: LeadKind = 'carrier',
): Promise<{ verified: ScannedCarrier[]; rejected: number }> {
  const mcs = [...new Set(candidates.map((c) => c.mc))]
  const results = new Map<number, SaferSnapshot>()
  // Stop the other workers as soon as one fails for good.
  const workers = new AbortController()
  signal.addEventListener('abort', () => workers.abort(), { once: true })

  let next = 0
  let done = 0
  const work = async () => {
    while (next < mcs.length) {
      const mc = mcs[next++]
      results.set(mc, await checkSafer(mc, workers.signal, onStatus))
      onStatus(`Verifying carriers on SAFER: ${++done} of ${mcs.length}…`)
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, mcs.length) }, work))
  } catch (e) {
    workers.abort()
    throw e
  }

  const checkedAt = new Date().toISOString()
  const verified: ScannedCarrier[] = []
  for (const c of candidates) {
    const s = results.get(c.mc)
    // SAFER's "authorized" is carrier authority; a broker needs "AUTHORIZED FOR Broker" and an in-service USDOT.
    const ok = s?.found && (kind === 'broker' ? s.broker && !s.usdotStatus.includes('OUT-OF-SERVICE') : s.authorized)
    if (s?.found && ok && (!s.dot || Number(s.dot) === Number(c.dot))) {
      verified.push({ ...c, safer: { ...s, checkedAt } })
    }
  }
  return { verified, rejected: candidates.length - verified.length }
}
