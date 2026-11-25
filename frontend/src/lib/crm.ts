// Dispatcher CRM: types shared with the backend, the API, and the week math behind "weekly gross".

export interface CrmUser { id: number; email: string; name: string; picture: string }
export interface Dispatcher { id: number; name: string; percent: number }
export type FeeType = 'percent' | 'flat'
export interface CrmCarrier {
  id: number; name: string; mc: string; dot: string; phone: string; email: string; notes: string
  /** Dispatch fee: a percent of each load's gross, or a flat amount per week. */
  feeType: FeeType; fee: number
  factoring: string
  /** Where the factoring company takes invoice packets. */
  factoringEmail?: string
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
  /** The broker's MC (digits), for the FMCSA check. */
  brokerMc: string
  /** Brokerage boards: what the carrier is paid (margin = gross − carrier pay); 0 = not set. */
  carrierPay?: number
  /** Brokerage boards: when the carrier was paid. */
  carrierPaidOn?: string | null
}
export type LoadInput = Omit<Load, 'id'>
export type CarrierInput = Omit<CrmCarrier, 'id'>
export type TruckInput = Omit<Truck, 'id'>
export type CompanyType = 'dispatch' | 'carrier' | 'broker'
export interface Company { name: string; type: CompanyType | ''; mc: string; dot: string; phone: string; fleetSize: string }
/** A brokerage board: loads come from customers (the `broker` field holds the customer) and carriers are paid per load. */
export const isBroker = (s: { company?: { type?: string } } | null | undefined) => s?.company?.type === 'broker'
/** Words that change on a brokerage board. */
export const words = (broker: boolean) => broker
  ? { customer: 'Customer', customers: 'Customers', customerLower: 'customer', dispatcher: 'Agent', dispatchers: 'Agents' }
  : { customer: 'Broker', customers: 'Brokers', customerLower: 'broker', dispatcher: 'Dispatcher', dispatchers: 'Dispatchers' }
/** Margin of a load on a brokerage board (null until the carrier pay is set). */
export const margin = (l: Load) => (l.carrierPay && l.carrierPay > 0 ? gross(l) - l.carrierPay : null)
/** What a dispatcher's / agent's percent is taken from: gross on a dispatch board, margin on a brokerage board. */
export const payBase = (l: Load, broker: boolean) => (broker ? Math.max(0, margin(l) ?? 0) : gross(l))
export const COMPANY_TYPES: [CompanyType, string, string][] = [
  ['dispatch', 'Dispatch service', 'I dispatch trucks for carriers'],
  ['carrier', 'Carrier / fleet', 'I own or run trucks'],
  ['broker', 'Freight broker', 'I broker loads'],
]
export const FLEET_SIZES = ['1', '2–5', '6–20', '21–50', '50+']
export interface SignUpInput { name: string; email: string; password: string; company: string; companyType: CompanyType | ''; mc: string; dot: string; phone: string; fleetSize: string; invite?: string }
/** Sign-in either finishes (user) or needs the emailed code first (verify). */
export type AuthResult = { user: CrmUser; verify?: undefined } | { verify: true; email: string; user?: undefined }

export interface CrmState {
  user: CrmUser; company?: Company; dispatchers: Dispatcher[]; carriers: CrmCarrier[]; trucks: Truck[]; loads: Load[]; checks?: CompanyCheck[]
  files?: CrmFile[]; invoices?: SentInvoice[]; brokerEmails?: Record<string, string>
  /** Owner of the board, or a dispatcher invited to it (who sees only their own loads). */
  me?: { role: 'owner' | 'dispatcher'; dispatcherId: number | null }
  team?: Team
  /** Trucks whose driver connected the Telegram bot, and the last known position of each truck. */
  drivers?: { truckId: number; name: string }[]
  positions?: TruckPosition[]
  /** Vehicles from a connected ELD (Samsara / Motive). */
  eld?: EldUnit[]
}
export type EldProvider = 'samsara' | 'motive'
export interface EldHos { status: string; driveLeftMin: number | null; shiftLeftMin: number | null; cycleLeftMin: number | null; breakLeftMin: number | null }
export interface EldUnit {
  provider: EldProvider; vehicleId: string; name: string; truckId: number | null; linked: 'auto' | 'manual' | 'none'
  lat: number | null; lon: number | null; at: string | null; speedMph: number | null; heading?: number | null; address: string; driver: string; hos: EldHos | null
}
export interface Connection { provider: string; region: string; label: string; status: 'ok' | 'error'; error: string; connectedAt: string; syncedAt: string | null; invoices?: number }
export interface Integrations {
  ready: boolean; providers: EldProvider[]; quickbooks: boolean; connections: Connection[]; units: EldUnit[]
  /** Services the owner can connect for the AI assistant through their own MCP server. */
  mcp?: string[]
}
/** "11h00" from minutes; '' when unknown. */
export const hoursLeft = (min: number | null | undefined) => (min == null ? '' : `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`)
export const dutyLabel = (s: string) => ({ off_duty: 'Off duty', sleeper: 'Sleeper', driving: 'Driving', on_duty: 'On duty', yard_move: 'Yard move', personal_conveyance: 'Personal conveyance' } as Record<string, string>)[s] ?? ''
export interface Posting {
  broker: string; contact: string; email: string; phone: string; origin: string; destination: string; pickup_date: string
  equipment: string; weight_lbs: number; rate: number; miles: number; ref: string; notes: string
}
export interface PostingFit {
  loadedMiles: number; rpm: number; ok: boolean; why: string
  best: { truckId: number; unit: string; driver: string; deadhead: number; from: string; driveLeftMin: number | null } | null
}
export interface PostingRow { id: number; createdAt: string; status: 'new' | 'emailed' | 'dismissed'; emailedAt: string | null; emailedAuto: boolean; data: Posting; fit: PostingFit }
export interface InboxMessage { id: number; receivedAt: string; from: string; subject: string; kind: string; summary: string; postings: number; loadId: number | null; note: string }
export interface InboxSettings { autoEmail: boolean; minRpm: number; maxDeadhead: number; dailyCap: number }
export interface InboxView { enabled: boolean; ai: boolean; address: string; settings: InboxSettings; postings: PostingRow[]; messages: InboxMessage[] }
export interface TruckPosition {
  truckId: number; lat: number; lon: number; at: string; live: boolean
  /** From the ELD; a Telegram location has no speed or heading. Heading in degrees, 0 = north. */
  speedMph?: number | null; heading?: number | null; source?: 'eld' | 'telegram'
}
/** A breadcrumb of the truck's trail: [lon, lat, unix seconds, mph or -1]. */
export type TrailPoint = [number, number, number, number]
/** What the broker's tracking page shows (no money). */
export interface TrackingView {
  date: string; pro: string; origin: string; destination: string; status: LoadStatus; miles: number; company: string; truck: string
  position: TruckPosition | null; lane: LaneResult | null
  /** Where the truck has driven for this load (in transit only). */
  trail?: TrailPoint[]
}
export interface Team {
  members: { userId: number; name: string; email: string; dispatcherId: number | null }[]
  invites: { id: number; email: string; dispatcherId: number | null; expiresAt: string }[]
}
export const FILE_KINDS = [['ratecon', 'Rate con'], ['bol', 'BOL'], ['pod', 'POD'], ['invoice', 'Invoice'], ['carrier_rc', 'Carrier rate con'], ['other', 'Other']] as const
export type FileKind = (typeof FILE_KINDS)[number][0]
export interface CrmFile { id: number; loadId: number | null; kind: FileKind; name: string; mime: string; size: number; createdAt: string }
export interface SentInvoice { loadId: number; number: string; sentTo: string; sentAt: string; remind: boolean; reminders: number }
export interface InvoiceSend { to: string; cc?: string[]; attach: number[]; remind: boolean; note?: string }
export type CheckRole = 'broker' | 'carrier'
/** FMCSA check of a broker or carrier: one verdict and the warning signs behind it. */
export interface CompanyCheck {
  mc: number | null; dot: string; name: string; role: CheckRole; level: 'ok' | 'caution' | 'danger' | 'unknown'
  summary: string; flags: { level: 'caution' | 'danger'; text: string }[]; years: number | null; insurance: number | null; checkedAt: string
}
/** What AI read on a BOL or POD, and the load it belongs to. */
export interface DeliveryDoc {
  kind: 'bol' | 'pod' | 'other'; references: string[]; shipper: string; consignee: string; origin: string; destination: string
  pickupDate: string; deliveryDate: string; signedByReceiver: boolean; receiver: string; pieces: string; weight: string; exceptions: string
}
export interface DocMatch { loadId: number | null; why: string; candidates: { loadId: number; score: number; why: string }[] }
export interface MilesResult { miles: number; estimate: boolean }
/** A lane on the map: both ends and the road as [lon, lat], miles and driving hours. */
export interface LaneResult { a: [number, number]; b: [number, number]; miles: number; hours: number; line: [number, number][]; estimate: boolean; truck: boolean }

/** Defaults for the fields a new load doesn't need to fill in. */
export const LOAD_EXTRAS = {
  truckId: null, loadedMiles: 0, emptyMiles: 0, detention: 0, layover: 0, tonu: 0, other: 0, lumper: 0, invoicedOn: null, paidOn: null, brokerMc: '', carrierPay: 0, carrierPaidOn: null,
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

/** "Santa Monica, CA", "Dallas TX 75201" or a ZIP — enough to find on the map. A bare "CA" or "santa monica" is not. */
export const looksLikePlace = (s: string) =>
  /\b\d{5}\b/.test(s) || /[A-Za-z]{3,}.*[,\s]\s*[A-Za-z]{2}\.?(\s+\d{5}(-\d{4})?)?\s*$/.test(s.trim())

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
export interface CrmConfig { googleClientId: string; devLogin: boolean; enabled: boolean; emailAuth?: boolean; ai?: boolean; loadAlerts?: boolean }
/** Ask AI: the conversation as the panel shows it. */
export type AiCard =
  | { type: 'loads'; title: string; ids: number[] }
  | { type: 'table'; title: string; columns: string[]; rows: (string | number)[][] }
  | { type: 'check'; check: CompanyCheck }
  | { type: 'route'; from: string; to: string; miles: number; hours: number }
  | { type: 'link'; label: string; url: string }
  | { type: 'note'; text: string }
  | { type: 'kpis'; items: { label: string; value: string; sub?: string }[] }
  | { type: 'bars'; title: string; rows: { label: string; value: number; text: string }[] }
/** One thing the assistant did (old chats stored plain text). */
export interface AiStep { label: string; detail?: string; ms?: number; state: 'done' | 'error' | 'waiting' }
export interface AiItem { role: 'user' | 'assistant'; text?: string; file?: string; cards?: AiCard[]; pending?: string[]; actions?: string[]; steps?: (string | AiStep)[]; stopped?: boolean }
export interface AiAction {
  id: string; tool: string; summary: string; status: 'pending' | 'done' | 'declined' | 'failed' | 'undone'
  preview?: { to: string; subject: string; lines: string[] }; undoable?: boolean
}
export interface AiView { threadId: string; title?: string; items: AiItem[]; pending: AiAction[]; actions?: AiAction[] }
/** What the screen gets while the assistant works (server-sent events). */
export type AiEvent =
  | { type: 'start'; threadId: string }
  | { type: 'thinking' }
  | { type: 'step'; id: string; label: string; state: 'running' | AiStep['state']; detail?: string; ms?: number }
  | { type: 'text'; delta: string }
  | { type: 'card'; card: AiCard }
  | { type: 'action'; action: AiAction }
  | { type: 'error'; message: string }
  | { type: 'done'; view: AiView }
/** What an AI import found, before anything is saved. */
export interface ImportPlan {
  id: string
  sources: { name: string; what: string; rows: number }[]
  skipped: { name: string; reason: string }[]
  dispatchers: { name: string; percent: number; existing?: boolean }[]
  carriers: { name: string; mc: string; dot: string; phone: string; email: string; feePercent: number; factoring: string; existing?: boolean }[]
  trucks: { unit: string; driver: string; phone: string; carrier: string; existing?: boolean }[]
  loads: { date: string; broker: string; pro: string; origin: string; destination: string; rate: number; carrier: string; truck: string; dispatcher: string; status: LoadStatus; source: string; duplicate?: boolean }[]
  brokers: { name: string; mc: string; email: string }[]
}
/** A rate confirmation read by AI. */
export interface RateConFields {
  isRateConfirmation: boolean; broker: string; brokerMc: string; brokerEmail: string; loadNumber: string; pickupDate: string; deliveryDate: string
  origin: string; destination: string; rate: number; miles: number; notes: string
}
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

/**
 * A streamed AI request: each event is handed to `on` as it arrives. Aborting `signal` (the Stop button) stops the
 * assistant on the server too; the final `done` event carries the saved chat.
 */
async function stream(path: string, body: unknown, on: (e: AiEvent) => void, signal?: AbortSignal): Promise<void> {
  let res: Response
  try {
    res = await fetch(`/api/crm${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify(body), signal })
  } catch (e) {
    if (signal?.aborted) return
    throw new CrmError('Server is not reachable', 0)
  }
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => null)
    throw new CrmError(data?.message || `HTTP ${res.status}`, res.status)
  }
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let i
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i)
        buf = buf.slice(i + 2)
        const data = chunk.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n')
        if (data) on(JSON.parse(data) as AiEvent)
      }
    }
  } catch (e) {
    if (!signal?.aborted) throw e
  }
}

/** Sends raw bytes (a PDF or photo) to the API. */
async function sendBytes<T>(path: string, file: Blob): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api/crm${path}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file })
  } catch {
    throw new CrmError('Server is not reachable', 0)
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new CrmError(data?.message || `HTTP ${res.status}`, res.status)
  return data as T
}

/** Uploads one document of a load as raw bytes. */
async function upload(loadId: number, file: Blob, name: string, kind: FileKind): Promise<CrmFile> {
  let res: Response
  try {
    res = await fetch(`/api/crm/loads/${loadId}/files?${new URLSearchParams({ kind, name })}`, {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file,
    })
  } catch {
    throw new CrmError('Server is not reachable', 0)
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new CrmError(data?.message || `HTTP ${res.status}`, res.status)
  return data as CrmFile
}

export const crm = {
  config: () => call<CrmConfig>('GET', '/config'),
  google: (credential: string) => call<{ user: CrmUser }>('POST', '/auth/google', { credential }),
  devLogin: (name: string) => call<{ user: CrmUser }>('POST', '/auth/dev', { name }),
  logout: () => call<{ ok: true }>('POST', '/auth/logout'),
  me: () => call<{ user: CrmUser | null }>('GET', '/me'),
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
  /** US cities for what is typed in a lane field: "santa mo" → ["Santa Monica, CA", …]. */
  places: (q: string) => call<string[]>('GET', `/places?${new URLSearchParams({ q })}`),
  uploadFile: upload,
  aiRateCon: (file: Blob) => sendBytes<RateConFields>('/ai/ratecon', file),
  /** AI reads a BOL / POD and the board finds its load (nothing is saved). */
  aiDoc: (file: Blob) => sendBytes<{ doc: DeliveryDoc; match: DocMatch }>('/ai/doc', file),
  carrierRcUrl: (loadId: number) => `/api/crm/loads/${loadId}/carrier-ratecon.pdf`,
  sendCarrierRc: (loadId: number, to: string, note?: string) => call<{ ok: true; number: string; to: string }>('POST', `/loads/${loadId}/carrier-ratecon`, { to, note }),
  aiChat: (v: { threadId?: string; text: string; file?: { name: string; data: string }; loadId?: number | null }) => call<AiView>('POST', '/ai/chat', v),
  aiDecide: (threadId: string, actionId: string, approve: boolean) => call<AiView>('POST', '/ai/decide', { threadId, actionId, approve }),
  aiChatStream: (v: { threadId?: string; text: string; file?: { name: string; data: string }; loadId?: number | null }, on: (e: AiEvent) => void, signal?: AbortSignal) => stream('/ai/chat/stream', v, on, signal),
  aiDecideStream: (threadId: string, actionId: string, approve: boolean, on: (e: AiEvent) => void, signal?: AbortSignal) => stream('/ai/decide/stream', { threadId, actionId, approve }, on, signal),
  aiUndo: (threadId: string, actionId: string) => call<AiView>('POST', '/ai/undo', { threadId, actionId }),
  aiImport: (v: { files: { name: string; data: string }[]; sheetUrl?: string }) => call<ImportPlan>('POST', '/ai/import', v),
  aiImportApply: (id: string, skipLoads: number[] = []) => call<{ dispatchers: number; carriers: number; trucks: number; loads: number; brokers: number }>('POST', '/ai/import/apply', { id, skip: { loads: skipLoads } }),
  aiThread: (id: string) => call<AiView>('GET', `/ai/thread/${encodeURIComponent(id)}`),
  aiThreads: () => call<{ id: string; title: string; updatedAt: string }[]>('GET', '/ai/threads'),
  aiDeleteThread: (id: string) => call('DELETE', `/ai/thread/${encodeURIComponent(id)}`),
  driverLink: (truckId: number) => call<{ url: string }>('POST', `/trucks/${truckId}/driver-link`),
  disconnectDriver: (truckId: number) => call('DELETE', `/trucks/${truckId}/driver`),
  trackingLink: (loadId: number) => call<{ url: string }>('POST', `/loads/${loadId}/tracking`),
  track: (token: string) => call<TrackingView>('GET', `/track/${encodeURIComponent(token)}`),
  invite: (dispatcherId: number, email: string) => call('POST', '/invites', { dispatcherId, email }),
  removeInvite: (id: number) => call('DELETE', `/invites/${id}`),
  removeMember: (userId: number) => call('DELETE', `/members/${userId}`),
  inviteInfo: (token: string) => call<{ email: string; company: string; dispatcher: string }>('GET', `/invites/${encodeURIComponent(token)}`),
  acceptInvite: (token: string) => call<{ ok: true; company: string }>('POST', '/invites/accept', { token }),
  fileUrl: (id: number) => `/api/crm/files/${id}`,
  setFileKind: (id: number, kind: FileKind) => call('PATCH', `/files/${id}`, { kind }),
  removeFile: (id: number) => call('DELETE', `/files/${id}`),
  invoicePdfUrl: (loadId: number, attach: number[]) => `/api/crm/loads/${loadId}/invoice.pdf?${new URLSearchParams({ attach: attach.join(',') })}`,
  sendInvoice: (loadId: number, v: InvoiceSend) => call<{ ok: true; number: string }>('POST', `/loads/${loadId}/invoice`, v),
  inbox: () => call<InboxView>('GET', '/inbox'),
  saveInbox: (v: InboxSettings) => call<{ ok: true }>('PATCH', '/inbox/settings', v),
  postingDraft: (id: number) => call<{ to: string; subject: string; body: string }>('GET', `/inbox/postings/${id}/draft`),
  emailPosting: (id: number, subject: string, body: string) => call<{ ok: true; to: string }>('POST', `/inbox/postings/${id}/email`, { subject, body }),
  dismissPosting: (id: number) => call<{ ok: true }>('POST', `/inbox/postings/${id}/dismiss`),
  pasteEmail: (text: string) => call<{ ok: true; kind: string; postings: number; loadId: number | null }>('POST', '/inbox/paste', { text }),
  integrations: () => call<Integrations>('GET', '/integrations'),
  connectEld: (provider: EldProvider, token: string, region: string) => call<{ ok: true; vehicles: number; linked: number; hos: number }>('POST', `/integrations/eld/${provider}`, { token, region }),
  syncEld: (provider: EldProvider) => call<{ ok: true; vehicles: number; linked: number; hos: number }>('POST', `/integrations/eld/${provider}/sync`),
  qboConnect: () => call<{ url: string }>('POST', '/integrations/quickbooks/connect'),
  qboSync: () => call<{ ok: true; pushed: number; paid: number }>('POST', '/integrations/quickbooks/sync'),
  disconnect: (provider: string) => call<{ ok: true }>('DELETE', `/integrations/${provider}`),
  mcpConnect: (app: string) => call<{ url: string }>('POST', `/integrations/mcp/${app}/connect`),
  mcpTools: (app: string) => call<{ tools: { name: string; description: string }[] }>('GET', `/integrations/mcp/${app}/tools`),
  linkUnit: (provider: EldProvider, vehicleId: string, v: { truckId?: number | null; create?: boolean }) => call<{ ok: true; truckId: number | null }>('PATCH', `/integrations/eld/${provider}/units/${encodeURIComponent(vehicleId)}`, v),
  sendFactoring: (loadId: number, v: Omit<InvoiceSend, 'remind'> & { factoring?: string }) => call<{ ok: true; number: string }>('POST', `/loads/${loadId}/factoring`, v),
  setInvoiceReminders: (loadId: number, remind: boolean) => call('PATCH', `/loads/${loadId}/invoice`, { remind }),
  /** FMCSA check of an MC as a broker or a carrier. */
  check: (mc: string, role: CheckRole) => call<CompanyCheck>('GET', `/check?${new URLSearchParams({ mc, role })}`),
  lane: (from: string, to: string) => call<LaneResult>('GET', `/lane?${new URLSearchParams({ from, to })}`),
  /** Map points of places, { "Dallas, TX": [lon, lat] | null }. */
  points: (places: string[]) => call<Record<string, [number, number] | null>>('POST', '/points', { places }),
  /** Where a truck has been in the last hours (fleet map trail). */
  trail: (truckId: number, hours = 24) => call<{ points: TrailPoint[] }>('GET', `/trucks/${truckId}/trail?hours=${hours}`),
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
  ['date', /^(date|day|load date|pick ?up date|pu date|ship date)$/i],
  ['broker', /^(company( name)?|broker( name)?|customer( name)?|shipper|bill to)$/i],
  ['pro', /^(pro ?#?|pro number|load ?(#|id|no\.?)?|load number|order ?(#|id)?|ref(erence)? ?#?|confirmation ?#?)$/i],
  ['origin', /^(origin( city)?|from( city)?|pick ?up( city| location)?|pu city|shipper city)$/i],
  ['destination', /^(destination( city)?|dest|to( city)?|delivery( city)?|drop( city)?|del city|consignee city)$/i],
  ['rate', /^(rate|rate \$|amount|gross|price|pay|linehaul|total( rate)?)$/i],
  ['dispatcher', /^(bb|dispatcher|booked by|disp)$/i],
  ['carrier', /^(carrier( name)?|truck|driver|unit)$/i],
  ['loadedMiles', /^(miles|loaded miles|mi|mileage|loaded mi|loaded)$/i],
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
