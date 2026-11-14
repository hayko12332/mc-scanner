// Dispatcher CRM: types shared with the backend, the API, and the week math behind "weekly gross".

export interface CrmUser { id: number; email: string; name: string; picture: string }
export interface Dispatcher { id: number; name: string; percent: number }
export type FeeType = 'percent' | 'flat'
export interface CrmCarrier {
  id: number; name: string; mc: string; dot: string; phone: string; email: string; notes: string
  /** Dispatch fee: a percent of each load's gross, or a flat amount per week. */
  feeType: FeeType; fee: number
  factoring: string
}
export interface Truck { id: number; carrierId: number | null; unit: string; driver: string; phone: string }
export const STATUSES = [
  { id: 'booked', label: 'Booked' },
  { id: 'in_transit', label: 'In transit' },
  { id: 'delivered', label: 'Delivered' },
  { id: 'invoiced', label: 'Invoiced' },
  { id: 'paid', label: 'Paid' },
] as const
export type LoadStatus = (typeof STATUSES)[number]['id']

export interface Load {
  id: number
  date: string
  carrierId: number | null
  dispatcherId: number | null
  broker: string
  pro: string
  origin: string
  destination: string
  rate: number
  notes: string
  status: LoadStatus
  truckId: number | null
  loadedMiles: number
  /** Deadhead to the pickup. */
  emptyMiles: number
  detention: number
  layover: number
  tonu: number
  other: number
  /** Reimbursed to the carrier; not part of gross. */
  lumper: number
  invoicedOn: string | null
  paidOn: string | null
}
export type LoadInput = Omit<Load, 'id'>
export type CarrierInput = Omit<CrmCarrier, 'id'>
export type TruckInput = Omit<Truck, 'id'>
export type CompanyType = 'dispatch' | 'carrier' | 'broker'
export interface Company { name: string; type: CompanyType | ''; mc: string; dot: string; phone: string; fleetSize: string }
export const COMPANY_TYPES: [CompanyType, string, string][] = [
  ['dispatch', 'Dispatch service', 'I dispatch trucks for carriers'],
  ['carrier', 'Carrier / fleet', 'I own or run trucks'],
  ['broker', 'Freight broker', 'I broker loads'],
]
export const FLEET_SIZES = ['1', '2–5', '6–20', '21–50', '50+']
export interface SignUpInput { name: string; email: string; password: string; company: string; companyType: CompanyType | ''; mc: string; dot: string; phone: string; fleetSize: string }
/** Sign-in either finishes (user) or needs the emailed code first (verify). */
export type AuthResult = { user: CrmUser; verify?: undefined } | { verify: true; email: string; user?: undefined }

export interface CrmState { user: CrmUser; company?: Company; dispatchers: Dispatcher[]; carriers: CrmCarrier[]; trucks: Truck[]; loads: Load[] }
export interface MilesResult { miles: number; estimate: boolean }

/** Defaults for the fields a new load doesn't need to fill in. */
export const LOAD_EXTRAS = {
  truckId: null, loadedMiles: 0, emptyMiles: 0, detention: 0, layover: 0, tonu: 0, other: 0, lumper: 0, invoicedOn: null, paidOn: null,
} satisfies Partial<Load>

/** Days a broker has to pay after the invoice before the load counts as overdue. */
export const PAY_TERMS_DAYS = 30

/** Accessorials that are revenue (lumper is a pass-through reimbursement). */
export const extras = (l: Load) => l.detention + l.layover + l.tonu + l.other
/** Gross of a load: the rate plus detention, layover, TONU and other charges. Lumper is not included. */
export const gross = (l: Load) => l.rate + extras(l)
/** Dollars per loaded mile, or null without miles. */
export const rpm = (amount: number, miles: number) => (miles > 0 ? amount / miles : null)
export const fmtRpm = (v: number | null) => (v == null ? '—' : `$${v.toFixed(2)}`)
export const fmtMiles = (n: number) => (n ? n.toLocaleString('en-US') : '—')

/** Days between two YYYY-MM-DD dates. */
export const daysBetween = (a: string, b: string) => Math.round((parse(b).getTime() - parse(a).getTime()) / 86_400_000)

/** Days past the payment terms for an invoiced, unpaid load (0 when not overdue). */
export function overdueDays(l: Load, on = today()): number {
  if (l.status !== 'invoiced' || !l.invoicedOn) return 0
  return Math.max(0, daysBetween(l.invoicedOn, on) - PAY_TERMS_DAYS)
}

/**
 * Status changes fill in the billing dates the way a dispatcher would: marking a load invoiced stamps today as the
 * invoice date, marking it paid stamps the payment date, and moving it back clears the dates that no longer apply.
 */
export function withStatusDates(l: Load, status: LoadStatus, on = today()): Pick<Load, 'status' | 'invoicedOn' | 'paidOn'> {
  const order = STATUSES.findIndex((s) => s.id === status)
  const invoiced = order >= STATUSES.findIndex((s) => s.id === 'invoiced')
  const paid = status === 'paid'
  return {
    status,
    invoicedOn: invoiced ? (l.invoicedOn ?? on) : null,
    paidOn: paid ? (l.paidOn ?? on) : null,
  }
}

/** What a carrier owes the dispatch service for a set of loads (one week): percent of gross, or the flat weekly fee. */
export function carrierFee(c: Pick<CrmCarrier, 'feeType' | 'fee'> | undefined, loads: Load[]): number {
  if (!c || !loads.length) return 0
  if (c.feeType === 'flat') return c.fee
  return (loads.reduce((s, l) => s + gross(l), 0) * c.fee) / 100
}
export const feeLabel = (c: Pick<CrmCarrier, 'feeType' | 'fee'> | undefined) =>
  !c || !c.fee ? 'No fee set' : c.feeType === 'flat' ? `${usd(c.fee)} / week` : `${c.fee}% of gross`
export interface CrmConfig { googleClientId: string; devLogin: boolean; enabled: boolean; emailAuth?: boolean }
export interface ImportRow {
  date: string; broker: string; pro: string; origin: string; destination: string; rate: number; dispatcher: string; carrier: string
  loadedMiles: number
}

export class CrmError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api/crm${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new CrmError('Server is not reachable', 0)
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new CrmError((Array.isArray(data?.message) ? data.message.join('; ') : data?.message) || `HTTP ${res.status}`, res.status)
  return data as T
}

export const crm = {
  config: () => call<CrmConfig>('GET', '/config'),
  google: (credential: string) => call<{ user: CrmUser }>('POST', '/auth/google', { credential }),
  devLogin: (name: string) => call<{ user: CrmUser }>('POST', '/auth/dev', { name }),
  logout: () => call<{ ok: true }>('POST', '/auth/logout'),
  signUp: (v: SignUpInput) => call<AuthResult>('POST', '/auth/signup', v),
  login: (email: string, password: string) => call<AuthResult>('POST', '/auth/login', { email, password }),
  verify: (email: string, code: string) => call<{ user: CrmUser }>('POST', '/auth/verify', { email, code }),
  resend: (email: string, purpose: 'verify' | 'reset') => call<{ ok: true }>('POST', '/auth/resend', { email, purpose }),
  forgot: (email: string) => call<{ ok: true }>('POST', '/auth/forgot', { email }),
  reset: (email: string, code: string, password: string) => call<{ user: CrmUser }>('POST', '/auth/reset', { email, code, password }),
  setCompany: (c: Omit<Company, 'type'> & { type: CompanyType | '' }) =>
    call<Company>('POST', '/company', { company: c.name, companyType: c.type, mc: c.mc, dot: c.dot, phone: c.phone, fleetSize: c.fleetSize }),
  state: () => call<CrmState>('GET', '/state'),
  addDispatcher: (d: Omit<Dispatcher, 'id'>) => call<Dispatcher>('POST', '/dispatchers', d),
  updateDispatcher: (d: Dispatcher) => call<Dispatcher>('PATCH', `/dispatchers/${d.id}`, d),
  removeDispatcher: (id: number) => call('DELETE', `/dispatchers/${id}`),
  addCarrier: (c: CarrierInput) => call<CrmCarrier>('POST', '/carriers', c),
  updateCarrier: (id: number, c: CarrierInput) => call<CrmCarrier>('PATCH', `/carriers/${id}`, c),
  removeCarrier: (id: number) => call('DELETE', `/carriers/${id}`),
  addTruck: (t: TruckInput) => call<Truck>('POST', '/trucks', t),
  updateTruck: (id: number, t: TruckInput) => call<Truck>('PATCH', `/trucks/${id}`, t),
  removeTruck: (id: number) => call('DELETE', `/trucks/${id}`),
  miles: (from: string, to: string) => call<MilesResult>('GET', `/miles?${new URLSearchParams({ from, to })}`),
  addLoad: (l: LoadInput) => call<Load>('POST', '/loads', l),
  updateLoad: (id: number, l: LoadInput) => call<Load>('PATCH', `/loads/${id}`, l),
  removeLoad: (id: number) => call('DELETE', `/loads/${id}`),
  importLoads: (rows: ImportRow[]) => call<{ imported: number }>('POST', '/loads/import', { rows }),
}

export const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: n % 1 ? 2 : 0 })

/** Local today as YYYY-MM-DD. */
export const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const parse = (iso: string) => new Date(iso + 'T12:00:00Z')
const iso = (d: Date) => d.toISOString().slice(0, 10)

/** Monday of the week the date falls in (dispatch weeks run Monday to Sunday). */
export function weekStart(date: string): string {
  const d = parse(date)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return iso(d)
}

export function addDays(date: string, days: number): string {
  const d = parse(date)
  d.setUTCDate(d.getUTCDate() + days)
  return iso(d)
}

export const shortDate = (date: string) => parse(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

export interface WeekGroup {
  start: string
  end: string
  loads: Load[]
  gross: number
  /** Dispatcher id → their earnings this week (rate × their percent). */
  pay: Map<number, number>
}

/** Loads grouped into Monday–Sunday weeks, newest week first, with weekly gross and each dispatcher's pay. */
export function byWeek(loads: Load[], dispatchers: Dispatcher[]): WeekGroup[] {
  const percent = new Map(dispatchers.map((d) => [d.id, d.percent]))
  const weeks = new Map<string, WeekGroup>()
  for (const l of loads) {
    const start = weekStart(l.date)
    let w = weeks.get(start)
    if (!w) weeks.set(start, (w = { start, end: addDays(start, 6), loads: [], gross: 0, pay: new Map() }))
    w.loads.push(l)
    w.gross += gross(l)
    if (l.dispatcherId != null) w.pay.set(l.dispatcherId, (w.pay.get(l.dispatcherId) ?? 0) + (gross(l) * (percent.get(l.dispatcherId) ?? 0)) / 100)
  }
  for (const w of weeks.values()) w.loads.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
  return [...weeks.values()].sort((a, b) => b.start.localeCompare(a.start))
}

// Spreadsheet import (copied from Google Sheets / Excel: tab-separated, with a header row)

const COLUMNS: [keyof ImportRow, RegExp][] = [
  ['date', /^(date|day|load date|pick ?up date)$/i],
  ['broker', /^(company( name)?|broker|customer|shipper)$/i],
  ['pro', /^(pro ?#?|pro number|load ?#?|load number|ref(erence)? ?#?)$/i],
  ['origin', /^(origin|from|pick ?up|pickup location|shipper city)$/i],
  ['destination', /^(destination|to|delivery|drop|consignee city)$/i],
  ['rate', /^(rate|amount|gross|price|pay)$/i],
  ['dispatcher', /^(bb|dispatcher|booked by|disp)$/i],
  ['carrier', /^(carrier|truck|driver|unit)$/i],
  ['loadedMiles', /^(miles|loaded miles|mi|mileage|loaded mi)$/i],
]

/** "10/20/2026", "10/20/26", "2026-10-20" or "Oct 20, 2026" → YYYY-MM-DD, or null. */
export function sheetDate(s: string): string | null {
  const t = s.trim()
  let m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/)
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
    const out = `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
    return Number.isNaN(parse(out).getTime()) || iso(parse(out)) !== out ? null : out
  }
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) return t
  const d = new Date(t)
  return t && !Number.isNaN(d.getTime()) && /\d{4}/.test(t) ? iso(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12))) : null
}

export interface ParsedSheet {
  rows: ImportRow[]
  /** Columns found in the header, by field. */
  found: (keyof ImportRow)[]
  /** Rows with text but no usable date (totals, notes) that were left out, as they read in the sheet. */
  skipped: string[]
}

/** Parses pasted spreadsheet text. The first row with a "Date" column is the header. */
export function parseSheet(text: string, defaultCarrier = ''): ParsedSheet {
  const lines = text.replace(/\r/g, '').split('\n').map((l) => l.split('\t'))
  const headerAt = lines.findIndex((cells) => cells.some((c) => COLUMNS[0][1].test(c.trim())))
  if (headerAt < 0) return { rows: [], found: [], skipped: [] }
  const index = new Map<keyof ImportRow, number>()
  lines[headerAt].forEach((cell, i) => {
    const field = COLUMNS.find(([, re]) => re.test(cell.trim()))?.[0]
    if (field && !index.has(field)) index.set(field, i)
  })
  const cell = (cells: string[], f: keyof ImportRow) => (index.has(f) ? (cells[index.get(f)!] ?? '').trim() : '')
  const rows: ImportRow[] = []
  const skipped: string[] = []
  for (const cells of lines.slice(headerAt + 1)) {
    if (!cells.some((c) => c.trim())) continue
    const date = sheetDate(cell(cells, 'date'))
    if (!date) { skipped.push(cells.map((c) => c.trim()).filter(Boolean).join(' · ')); continue }
    rows.push({
      date,
      broker: cell(cells, 'broker'),
      pro: cell(cells, 'pro'),
      origin: cell(cells, 'origin'),
      destination: cell(cells, 'destination'),
      rate: Number(cell(cells, 'rate').replace(/[$,\s]/g, '')) || 0,
      dispatcher: cell(cells, 'dispatcher'),
      carrier: cell(cells, 'carrier') || defaultCarrier,
      loadedMiles: Math.round(Number(cell(cells, 'loadedMiles').replace(/[,\s]/g, ''))) || 0,
    })
  }
  return { rows, found: [...index.keys()], skipped }
}
