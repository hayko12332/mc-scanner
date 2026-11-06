export function formatPhone(phone: string): string {
  const d = phone.replace(/\D/g, '')
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  if (d.length === 11 && d[0] === '1') return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  return phone
}

export const formatMoney = (amount: number | null) => (amount ? '$' + amount.toLocaleString('en-US') : '—')

export const formatNumber = (n: number | null) => (n == null ? '' : n.toLocaleString('en-US'))

/** ISO date or timestamp -> YYYY-MM-DD. */
export const formatDate = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '')

const sleepAborted = () => new DOMException('Aborted', 'AbortError')

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(sleepAborted())
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(sleepAborted())
    }, { once: true })
  })
}
