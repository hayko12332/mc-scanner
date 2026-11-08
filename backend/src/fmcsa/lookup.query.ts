import type { LookupKind } from './fmcsa.types.js';

export type LookupType = 'auto' | LookupKind;

export interface ParsedQuery {
  kinds: LookupKind[];
  /** Normalized value: digits for MC / USDOT / phone, upper-case for email. */
  value: string;
}

const PREFIXED = /^(MC|USDOT|DOT)[\s#:-]*(\d{1,8})$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Work out what a lookup string is; null if it cannot be searched as the requested type. */
export function parseLookupQuery(raw: string, type: LookupType = 'auto'): ParsedQuery | null {
  const q = raw.trim();
  if (!q) return null;
  const digits = q.replace(/\D/g, '');

  if (type === 'email' || (type === 'auto' && q.includes('@'))) {
    return EMAIL.test(q) ? { kinds: ['email'], value: q.toUpperCase() } : null;
  }
  if (type === 'phone') return phone(digits);

  const prefixed = q.match(PREFIXED);
  if (prefixed) {
    const kind: LookupKind = prefixed[1].toUpperCase() === 'MC' ? 'mc' : 'dot';
    if (type !== 'auto' && type !== kind) return null;
    return { kinds: [kind], value: String(parseInt(prefixed[2], 10)) };
  }
  if (type === 'mc' || type === 'dot') {
    return /^\d{1,8}$/.test(digits) && /^[\d\s-]+$/.test(q) ? { kinds: [type], value: String(parseInt(digits, 10)) } : null;
  }

  // auto, no prefix: 10-11 digits is a phone, up to 8 digits is an MC or USDOT number.
  if (!/^[\d\s()+.-]+$/.test(q)) return null;
  if (digits.length >= 10) return phone(digits);
  if (digits.length >= 1 && digits.length <= 8 && /^\d+$/.test(q)) {
    return { kinds: ['mc', 'dot'], value: String(parseInt(digits, 10)) };
  }
  return null;
}

/** FMCSA stores phones as 10 bare digits. */
function phone(digits: string): ParsedQuery | null {
  const d = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  return d.length === 10 ? { kinds: ['phone'], value: d } : null;
}
