// Usage analytics: events are queued and sent in small batches to /api/analytics/events.
// Failures are ignored — analytics must never get in the way of using the site.
import { telegramInitData } from './telegram'

type Props = Record<string, string | number | boolean | null>
interface QueuedEvent { event: string; props: Props; path: string; at: string }

const FLUSH_MS = 4000
const ENDPOINT = '/api/analytics/events'

const randomId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36)

function storedId(storage: () => Storage, key: string): string {
  try {
    let id = storage().getItem(key)
    if (!id) {
      id = randomId()
      storage().setItem(key, id)
    }
    return id
  } catch {
    return randomId()
  }
}

const visitorId = storedId(() => localStorage, 'mcScanner.visitor')
const sessionId = storedId(() => sessionStorage, 'mcScanner.session')
let queue: QueuedEvent[] = []
let timer: ReturnType<typeof setTimeout> | undefined

function payload(events: QueuedEvent[]) {
  return JSON.stringify({
    visitorId,
    sessionId,
    referrer: document.referrer,
    tgInitData: telegramInitData(),
    events,
  })
}

function flush(useBeacon = false) {
  clearTimeout(timer)
  timer = undefined
  if (!queue.length) return
  const body = payload(queue.splice(0, 50))
  if (useBeacon && navigator.sendBeacon?.(ENDPOINT, new Blob([body], { type: 'application/json' }))) return
  void fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true })
    .catch(() => {})
  if (queue.length) flush(useBeacon)
}

/** Record something the user did. Keep props small: they are stored as-is. */
export function track(event: string, props: Props = {}): void {
  queue.push({ event, props, path: location.hash || '#/', at: new Date().toISOString() })
  if (queue.length >= 20) flush()
  else timer ??= setTimeout(flush, FLUSH_MS)
}

/** Send what is queued when the tab is hidden or closed, and record clicks on external links. */
export function initAnalytics(): void {
  addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush(true))
  addEventListener('pagehide', () => flush(true))
  document.addEventListener('click', (e) => {
    const a = (e.target as Element | null)?.closest?.('a[href^="http"]') as HTMLAnchorElement | null
    if (a) track('outbound', { host: new URL(a.href).host, label: (a.textContent ?? '').trim().slice(0, 60) })
  }, { capture: true })
}
