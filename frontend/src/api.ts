import type { AuthorityMode, Insurance, SaferSnapshot, ScanResult } from './types'

export class ApiError extends Error {
  readonly status: number
  /** Seconds to wait before retrying (SAFER rate limit), when the server says so. */
  readonly retryAfter: number | null

  constructor(message: string, status: number, retryAfter: number | null) {
    super(message)
    this.status = status
    this.retryAfter = retryAfter
  }
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, { signal })
  } catch (e) {
    if (signal?.aborted) throw e
    throw new ApiError('Backend is not reachable', 0, null)
  }
  const body = await res.json().catch(() => null)
  if (res.ok) return body as T
  const message = Array.isArray(body?.message) ? body.message.join('; ') : body?.message
  throw new ApiError(message || `HTTP ${res.status}`, res.status, typeof body?.retryAfter === 'number' ? body.retryAfter : null)
}

export const api = {
  health: () => get<{ ok: boolean }>('/health'),
  scan: (from: number, to: number, mode: AuthorityMode, signal?: AbortSignal) =>
    get<ScanResult>(`/carriers?from=${from}&to=${to}&mode=${mode}`, signal),
  safer: (mc: number, signal?: AbortSignal) => get<SaferSnapshot>(`/safer/${mc}`, signal),
  insurance: (mc: number) => get<Insurance>(`/carriers/${mc}/insurance`),
  saferPageUrl: (dot: string) => `/api/safer/page/${encodeURIComponent(dot)}`,
}
