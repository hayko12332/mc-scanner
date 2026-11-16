import { useEffect, useState } from 'react'
import type { CheckRole, CompanyCheck, CrmState } from '../../lib/crm'

/** "C H ROBINSON WORLDWIDE INC" → "C H Robinson Worldwide Inc" (FMCSA names are in capitals); LLC, USA and the like stay. */
export const companyName = (s: string) => (/[a-z]/.test(s) ? s : s.toLowerCase()
  .replace(/\b([a-z])([a-z']*)/g, (_, a: string, b: string) => a.toUpperCase() + b)
  .replace(/\b(Llc|Usa|Us|Ltd|Lp|Llp|Pc|Dba|Ii|Iii)\b/g, (w) => w.toUpperCase()))
const cache = new Map<string, CompanyCheck | null>()

/** The saved check of an MC on this board (carriers are re-checked daily). */
export const savedCheck = (state: CrmState, mc: string, role: CheckRole) => {
  const digits = mc.replace(/\D/g, '')
  return digits ? state.checks?.find((c) => c.role === role && String(c.mc) === digits) : undefined
}

/**
 * Checks an MC with FMCSA a moment after it is typed (3+ digits): authority, bond or insurance, age, revocations.
 * Returns the saved check first when the board already has one.
 */
export function useCheck(mc: string, role: CheckRole, run: (mc: string, role: CheckRole) => Promise<CompanyCheck>, saved?: CompanyCheck) {
  const digits = mc.replace(/\D/g, '')
  const key = `${role}|${digits}`
  const [state, setState] = useState<{ key: string; check: CompanyCheck | null; error: string; busy: boolean }>({ key: '', check: null, error: '', busy: false })
  useEffect(() => {
    if (digits.length < 3 || digits.length > 8) return setState({ key, check: null, error: '', busy: false })
    if (saved && !cache.has(key)) cache.set(key, saved)
    if (cache.has(key)) return setState({ key, check: cache.get(key)!, error: '', busy: false })
    let stale = false
    setState({ key, check: null, error: '', busy: true })
    const t = setTimeout(() => {
      run(digits, role).then(
        (c) => { cache.set(key, c); if (!stale) setState({ key, check: c, error: '', busy: false }) },
        (e: Error) => { if (!stale) setState({ key, check: null, error: e.message, busy: false }) },
      )
    }, 500)
    return () => { stale = true; clearTimeout(t) }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return state.key === key ? state : { key, check: null, error: '', busy: digits.length >= 3 }
}

const ICON = { ok: '✓', caution: '!', danger: '✕', unknown: '?' } as const

/** The verdict as a pill; with `details`, the warning signs under it and a link to the full company card. */
export function CheckBadge({ check, busy, error, details }: { check: CompanyCheck | null; busy?: boolean; error?: string; details?: boolean }) {
  if (busy) return <span className="ck ck-busy"><i />Checking FMCSA…</span>
  if (error) return <span className="ck ck-unknown" title={error}><i>?</i>{error}</span>
  if (!check) return null
  const title = check.flags.length ? check.flags.map((f) => `• ${f.text}`).join('\n') : check.summary
  const pill = (
    <span className={`ck ck-${check.level}`} title={`${companyName(check.name)}\n${title}`}>
      <i>{ICON[check.level]}</i>{check.summary}
    </span>
  )
  if (!details) return pill
  return (
    <div className="ck-box">
      <div className="ck-row">
        {pill}
        <a className="ck-more" href={`#/lookup?q=${encodeURIComponent(`MC-${check.mc}`)}&type=mc`}>{companyName(check.name)} · full report →</a>
      </div>
      {check.flags.length > 1 && (
        <ul className="ck-flags">{check.flags.map((f) => <li key={f.text} className={f.level}>{f.text}</li>)}</ul>
      )}
    </div>
  )
}
