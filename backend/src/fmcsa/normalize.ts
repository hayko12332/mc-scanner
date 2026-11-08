export const joinAddress = (street?: string, city?: string, state?: string, zip?: string) =>
  [street, city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');

/** FMCSA files mix YYYYMMDD, MM/DD/YYYY and ISO timestamps; normalize to YYYY-MM-DD. */
export function toIsoDate(value: string | undefined): string | null {
  if (!value) return null;
  if (/^\d{8}$/.test(value)) return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`;
  if (/^\d{4}-\d\d-\d\d/.test(value)) return value.slice(0, 10);
  const m = value.match(/^(\d\d)\/(\d\d)\/(\d{4})$/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : value;
}

export function toNumber(value: string | undefined): number | null {
  if (value == null || value === '') return null;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

/** Positive dollar amount or null. */
export function dollars(value: string | undefined, multiplier = 1): number | null {
  const n = toNumber(value);
  return n != null && n > 0 ? Math.round(n * multiplier) : null;
}

/** Legacy L&I files store insurance amounts in thousands of dollars. */
export const legacyDollars = (value: string | undefined) => dollars(value, 1000);

export const yesNo = (value: string | undefined) => (value === 'Y' || value === 'N' ? value : '');

/** Legacy L&I dockets are zero-padded to 6 digits (MC000003); Motus uses MC3 for old numbers. */
export const legacyDocket = (mc: number) => 'MC' + String(mc).padStart(6, '0');
export const docketVariants = (mcs: number[]) => [...new Set(mcs.flatMap((mc) => [legacyDocket(mc), 'MC' + mc]))];
export const docketToMc = (docket: string) => parseInt(docket.slice(2), 10);
