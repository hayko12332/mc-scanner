import type { LookupType } from '../types'

// Same rules as the server (backend/src/fmcsa/lookup.query.ts), so the page can say what it will search by
// while the person types.

type Kind = 'mc' | 'dot' | 'email' | 'phone'
export interface Parsed { kinds: Kind[]; value: string }

const PREFIXED = /^(MC|USDOT|DOT)[\s#:-]*(\d{1,8})$/i
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function parseLookupQuery(raw: string, type: LookupType = 'auto'): Parsed | null {
  const q = raw.trim()
  if (!q) return null
  const digits = q.replace(/\D/g, '')
  if (type === 'email' || (type === 'auto' && q.includes('@'))) return EMAIL.test(q) ? { kinds: ['email'], value: q.toLowerCase() } : null
  if (type === 'phone') return phone(digits)
  const prefixed = q.match(PREFIXED)
  if (prefixed) {
    const kind: Kind = prefixed[1].toUpperCase() === 'MC' ? 'mc' : 'dot'
    if (type !== 'auto' && type !== kind) return null
    return { kinds: [kind], value: String(parseInt(prefixed[2], 10)) }
  }
  if (type === 'mc' || type === 'dot') return /^\d{1,8}$/.test(digits) && /^[\d\s-]+$/.test(q) ? { kinds: [type], value: String(parseInt(digits, 10)) } : null
  if (!/^[\d\s()+.-]+$/.test(q)) return null
  if (digits.length >= 10) return phone(digits)
  if (digits.length >= 1 && digits.length <= 8 && /^\d+$/.test(q)) return { kinds: ['mc', 'dot'], value: String(parseInt(digits, 10)) }
  return null
}

function phone(digits: string): Parsed | null {
  const d = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  return d.length === 10 ? { kinds: ['phone'], value: d } : null
}

/** "MC or USDOT 1491240", "email info@acme.com", "phone (614) 555-1234". */
export function describeQuery(p: Parsed): string {
  const what = p.kinds.map((k) => ({ mc: 'MC', dot: 'USDOT', email: 'email', phone: 'phone' })[k]).join(' or ')
  const value = p.kinds[0] === 'phone' ? `(${p.value.slice(0, 3)}) ${p.value.slice(3, 6)}-${p.value.slice(6)}` : p.value
  return `${what} ${value}`
}
