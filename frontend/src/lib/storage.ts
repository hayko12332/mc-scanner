// Per-browser persistence so a scan can resume after a reload. Storage can be unavailable
// (private mode, blocked site data), so every access is best-effort.

const KEY = 'mcScanner.v4'

export function loadState<T>(): Partial<T> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<T>
  } catch {
    return {}
  }
}

export function saveState<T>(state: T): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    // quota exceeded or storage blocked: the scan keeps working, it just won't survive a reload
  }
}
