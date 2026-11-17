import type Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'node:crypto';
import { api, BETAS, friendly, MODEL } from './ai.js';
import type { CompanyCheck } from './company-check.js';
import type { CarrierInput, LoadInput } from './crm.store.js';
import type { CrmCarrier, CrmState, Load, LoadStatus } from './crm.types.js';
import { LOAD_STATUSES } from './crm.types.js';

// "Ask AI" as an assistant that works the board, not a chat bot: it looks things up with tools (loads, totals,
// FMCSA checks, miles), shows results as cards, and proposes changes (new load, status, payment, invoice, carrier)
// that run only when the user taps Confirm. The conversation is kept on the server so it can pause for a
// confirmation and continue, with the model's own blocks passed back unchanged.

type Msg = Anthropic.Beta.BetaMessageParam;
type ToolResult = Anthropic.Beta.BetaToolResultBlockParam;

export type Card =
  | { type: 'loads'; title: string; ids: number[] }
  | { type: 'table'; title: string; columns: string[]; rows: (string | number)[][] }
  | { type: 'check'; check: CompanyCheck }
  | { type: 'route'; from: string; to: string; miles: number; hours: number }
  | { type: 'link'; label: string; url: string }
  | { type: 'note'; text: string };

export interface DisplayItem { role: 'user' | 'assistant'; text?: string; file?: string; cards?: Card[]; pending?: string[] }
export interface PendingAction { id: string; tool: string; input: Record<string, unknown>; summary: string; status: 'pending' | 'done' | 'declined' | 'failed'; result?: string }

export interface Thread {
  id: string;
  messages: Msg[];
  display: DisplayItem[];
  pending: PendingAction[];
  /** Results of the lookups made in the same turn as the pending actions, sent back together with their outcome. */
  readResults: ToolResult[];
  /** A file sent in this chat (e.g. a rate con), attached to the load the assistant creates from it. */
  file?: { name: string; mime: string; data: string } | null;
}

export const newThread = (): Thread => ({ id: randomUUID(), messages: [], display: [], pending: [], readResults: [], file: null });

/** What the assistant may use: the board as this person sees it and the board's own actions. */
export interface AgentCtx {
  state(): Promise<Omit<CrmState, 'user'> & { company: { name: string } }>;
  check(mc: string, role: 'broker' | 'carrier'): Promise<CompanyCheck | null>;
  lookup(query: string): Promise<Record<string, unknown>[]>;
  lane(from: string, to: string): Promise<{ miles: number; hours: number } | null>;
  createLoad(l: LoadInput): Promise<Load>;
  updateLoad(id: number, l: LoadInput): Promise<Load | null>;
  sendInvoice(loadId: number, to: string, attach: number[]): Promise<{ number: string }>;
  addCarrier(c: CarrierInput): Promise<CrmCarrier>;
  trackingLink(loadId: number): Promise<string>;
  attachFile(loadId: number, name: string, mime: string, data: Buffer): Promise<unknown>;
}

const WRITE_TOOLS = new Set(['create_load', 'update_load', 'send_invoice', 'add_carrier']);
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const gross = (l: Load) => l.rate + l.detention + l.layover + l.tonu + l.other;
const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const lc = (s: unknown) => String(s ?? '').trim().toLowerCase();
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v.replace(/[$,\s]/g, ''))) ? Number(v.replace(/[$,\s]/g, '')) : undefined);
const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object' as const, properties, required, additionalProperties: false });
const S = { type: 'string' }, N = { type: 'number' }, D = { type: 'string', description: 'YYYY-MM-DD' };
const STATUS = { type: 'string', enum: [...LOAD_STATUSES] };

export const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'find_loads',
    description: 'Find loads on the board by any mix of filters and get totals (count, gross, miles, RPM). The matching loads are shown to the user as a clickable card, so summarize instead of listing every row. Names match partially, case-insensitive.',
    input_schema: obj({
      statuses: { type: 'array', items: STATUS, description: 'booked, in_transit, delivered, invoiced, paid' }, from: D, to: D,
      broker: S, carrier: S, truck: { type: 'string', description: 'Unit number or driver name' }, dispatcher: S, lane: { type: 'string', description: 'City or state in origin or destination' },
      text: { type: 'string', description: 'Free text in load #, notes, broker, places' },
      unpaid: { type: 'boolean', description: 'Invoiced and not paid yet' }, overdue: { type: 'boolean', description: 'Invoiced more than 30 days ago and not paid' },
      not_invoiced: { type: 'boolean', description: 'Delivered but no invoice yet' }, limit: N,
    }),
  },
  {
    name: 'summarize',
    description: 'Totals for a period, optionally grouped: gross, loads, loaded and empty miles, RPM, deadhead %, dispatcher pay. Use for "how much did we make", "top brokers", "per dispatcher", "per week" questions. Shown to the user as a table card.',
    input_schema: obj({ from: D, to: D, group_by: { type: 'string', enum: ['none', 'dispatcher', 'carrier', 'broker', 'truck', 'lane', 'week', 'status'] } }, ['group_by']),
  },
  {
    name: 'get_load',
    description: 'Everything about one load: money, miles, carrier, truck, dispatcher, dates, documents attached, invoice sent or not, broker check.',
    input_schema: obj({ id: N }, ['id']),
  },
  {
    name: 'check_company',
    description: 'FMCSA check of a broker or a carrier by MC: authority, bond / insurance, age, revocations, safety rating. Shown as a card.',
    input_schema: obj({ mc: S, role: { type: 'string', enum: ['broker', 'carrier'] } }, ['mc', 'role']),
  },
  {
    name: 'lookup_company',
    description: 'Look up any company in FMCSA records by MC, USDOT, email or phone: name, status, address, fleet, authority.',
    input_schema: obj({ query: S }, ['query']),
  },
  {
    name: 'route_miles',
    description: 'Driving miles and hours between two places ("City, ST").',
    input_schema: obj({ from: S, to: S }, ['from', 'to']),
  },
  {
    name: 'tracking_link',
    description: 'The broker tracking link of a load (shows the truck on the lane, no money).',
    input_schema: obj({ load_id: N }, ['load_id']),
  },
  {
    name: 'create_load',
    description: 'Add a new load. The user confirms it with a button before it is saved. Use names for carrier, truck (unit) and dispatcher as they are on the board. If a file was sent in this chat, it is attached to the new load as the rate con.',
    input_schema: obj({
      date: D, broker: S, broker_mc: S, load_number: S, origin: { type: 'string', description: 'City, ST' }, destination: { type: 'string', description: 'City, ST' },
      rate: N, loaded_miles: N, empty_miles: N, carrier: S, truck: S, dispatcher: S, status: STATUS, notes: S,
    }, ['date', 'broker', 'origin', 'destination', 'rate']),
  },
  {
    name: 'update_load',
    description: 'Change a load: status, money, miles, carrier / truck / dispatcher, dates, notes. Setting status invoiced or paid fills the invoice / payment date with today unless given. The user confirms it with a button first.',
    input_schema: obj({
      id: N, status: STATUS, rate: N, detention: N, layover: N, tonu: N, other: N, lumper: N, loaded_miles: N, empty_miles: N,
      carrier: S, truck: S, dispatcher: S, broker: S, broker_mc: S, load_number: S, origin: S, destination: S, date: D, invoiced_on: D, paid_on: D, notes: S,
    }, ['id']),
  },
  {
    name: 'send_invoice',
    description: 'Email the invoice of a load to the broker as one PDF with the load documents (rate con, BOL, POD). If no email is given, the broker email used before is taken. The user confirms it first.',
    input_schema: obj({ load_id: N, to: { type: 'string', description: 'Broker billing email (optional)' }, attach_documents: { type: 'boolean' } }, ['load_id']),
  },
  {
    name: 'add_carrier',
    description: 'Add a carrier to the board. The user confirms it first.',
    input_schema: obj({ name: S, mc: S, phone: S, email: S, fee_percent: N, fee_weekly: N, factoring: S }, ['name']),
  },
];

const SYSTEM = `You are HaulPanel's assistant inside a dispatch company's TMS board. You work the board for the user: find and total their loads, check brokers and carriers with FMCSA, get miles, and prepare actions (create or change loads, mark paid, send invoices, add carriers).

Rules:
- Get every number from the tools; never guess or invent loads, amounts or companies. If the data isn't there, say what's missing.
- To change anything, call the action tool directly — the user sees a card with a Confirm button, so don't ask "shall I?" in text first. Batch several actions in one turn when the user asks for several.
- Tool results appear to the user as cards (load lists, tables, checks). Don't repeat them row by row: give the answer and the 1–3 key numbers, then what to do next if useful.
- Gross = rate + detention + layover + TONU + other (lumper is a reimbursement). RPM = gross / loaded miles; all-in includes empty miles. Overdue = invoiced over 30 days ago and unpaid. Weeks run Monday–Sunday.
- If a rate confirmation (PDF or photo) is sent, read it and call create_load with what it says; mention anything unclear.
- Be brief and practical, like an experienced dispatcher. Answer in the language the user writes in.`;

/** Finds a carrier / truck / dispatcher id by name (exact, then partial). */
function idByName<T extends { id: number }>(xs: T[], name: unknown, key: (x: T) => string[]): number | null | undefined {
  const n = lc(name);
  if (!n) return undefined;
  return (xs.find((x) => key(x).some((k) => lc(k) === n)) ?? xs.find((x) => key(x).some((k) => lc(k).includes(n))))?.id ?? null;
}

type St = Awaited<ReturnType<AgentCtx['state']>>;

function names(st: St) {
  const carrier = (id: number | null) => st.carriers.find((c) => c.id === id)?.name ?? '';
  const truck = (id: number | null) => { const t = st.trucks.find((x) => x.id === id); return t ? [t.unit && `#${t.unit}`, t.driver].filter(Boolean).join(' ') : ''; };
  const dispatcher = (id: number | null) => st.dispatchers.find((d) => d.id === id)?.name ?? '';
  return { carrier, truck, dispatcher };
}

function row(st: St, l: Load) {
  const n = names(st);
  return {
    id: l.id, date: l.date, status: l.status, broker: l.broker, broker_mc: l.brokerMc, load_number: l.pro, origin: l.origin, destination: l.destination,
    rate: l.rate, gross: gross(l), loaded_miles: l.loadedMiles, empty_miles: l.emptyMiles, carrier: n.carrier(l.carrierId), truck: n.truck(l.truckId),
    dispatcher: n.dispatcher(l.dispatcherId), invoiced_on: l.invoicedOn, paid_on: l.paidOn,
  };
}

const totals = (ls: Load[]) => {
  const g = ls.reduce((s, l) => s + gross(l), 0), mi = ls.reduce((s, l) => s + l.loadedMiles, 0), em = ls.reduce((s, l) => s + l.emptyMiles, 0);
  return { count: ls.length, gross: Math.round(g), loaded_miles: mi, empty_miles: em, rpm: mi ? Math.round((g / mi) * 100) / 100 : null, all_in_rpm: mi + em ? Math.round((g / (mi + em)) * 100) / 100 : null };
};

function findLoads(st: St, i: Record<string, unknown>): Load[] {
  const n = names(st);
  const statuses = Array.isArray(i.statuses) ? (i.statuses as string[]) : [];
  return st.loads.filter((l) => {
    if (statuses.length && !statuses.includes(l.status)) return false;
    if (isDate(i.from) && l.date < (i.from as string)) return false;
    if (isDate(i.to) && l.date > (i.to as string)) return false;
    if (i.broker && !lc(l.broker).includes(lc(i.broker))) return false;
    if (i.carrier && !lc(n.carrier(l.carrierId)).includes(lc(i.carrier))) return false;
    if (i.truck && !lc(n.truck(l.truckId)).includes(lc(i.truck).replace(/^#/, ''))) return false;
    if (i.dispatcher && !lc(n.dispatcher(l.dispatcherId)).includes(lc(i.dispatcher))) return false;
    if (i.lane && !lc(`${l.origin} ${l.destination}`).includes(lc(i.lane))) return false;
    if (i.text && !lc(`${l.pro} ${l.notes} ${l.broker} ${l.origin} ${l.destination}`).includes(lc(i.text))) return false;
    if (i.unpaid && l.status !== 'invoiced') return false;
    if (i.overdue && !(l.status === 'invoiced' && l.invoicedOn && addDays(l.invoicedOn, 30) < today())) return false;
    if (i.not_invoiced && !(l.status === 'delivered' && !l.invoicedOn)) return false;
    return true;
  }).sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
}

function summarize(st: St, i: Record<string, unknown>): { data: unknown; card: Card } {
  const ls = findLoads(st, { from: i.from, to: i.to });
  const n = names(st);
  const pct = new Map(st.dispatchers.map((d) => [d.id, d.percent]));
  const by = String(i.group_by ?? 'none');
  const key = (l: Load): string => {
    if (by === 'dispatcher') return n.dispatcher(l.dispatcherId) || 'No dispatcher';
    if (by === 'carrier') return n.carrier(l.carrierId) || 'No carrier';
    if (by === 'broker') return l.broker.trim() || 'No broker';
    if (by === 'truck') return n.truck(l.truckId) || 'No truck';
    if (by === 'status') return l.status;
    if (by === 'lane') { const s = (p: string) => /,\s*([A-Z]{2})\b/i.exec(p)?.[1]?.toUpperCase() ?? '?'; return `${s(l.origin)} → ${s(l.destination)}`; }
    if (by === 'week') { const d = new Date(l.date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return `Week of ${d.toISOString().slice(0, 10)}`; }
    return 'All loads';
  };
  const groups = new Map<string, Load[]>();
  for (const l of ls) groups.set(key(l), [...(groups.get(key(l)) ?? []), l]);
  const rows = [...groups.entries()].map(([k, g]) => {
    const t = totals(g);
    const pay = g.reduce((s, l) => s + (l.dispatcherId != null ? (gross(l) * (pct.get(l.dispatcherId) ?? 0)) / 100 : 0), 0);
    return { group: k, ...t, deadhead_pct: t.loaded_miles + t.empty_miles ? Math.round((t.empty_miles / (t.loaded_miles + t.empty_miles)) * 100) : 0, dispatcher_pay: Math.round(pay) };
  }).sort((a, b) => (by === 'week' ? b.group.localeCompare(a.group) : b.gross - a.gross));
  const period = `${isDate(i.from) ? i.from : 'start'} – ${isDate(i.to) ? i.to : 'today'}`;
  return {
    data: { period, group_by: by, rows: rows.slice(0, 60) },
    card: {
      type: 'table', title: `${by === 'none' ? 'Totals' : `By ${by}`} · ${period}`,
      columns: [by === 'none' ? '' : by[0].toUpperCase() + by.slice(1), 'Loads', 'Gross', 'RPM', 'Deadhead', ...(by === 'dispatcher' ? ['Pay'] : [])],
      rows: rows.slice(0, 25).map((r) => [r.group, r.count, usd(r.gross), r.rpm ? `$${r.rpm.toFixed(2)}` : '—', `${r.deadhead_pct}%`, ...(by === 'dispatcher' ? [usd(r.dispatcher_pay)] : [])]),
    },
  };
}

/** Status changes fill the billing dates the way a dispatcher would (same rule as the board). */
function withStatus(l: Load, status: LoadStatus): Pick<Load, 'status' | 'invoicedOn' | 'paidOn'> {
  const order = LOAD_STATUSES.indexOf(status);
  return {
    status,
    invoicedOn: order >= LOAD_STATUSES.indexOf('invoiced') ? (l.invoicedOn ?? today()) : null,
    paidOn: status === 'paid' ? (l.paidOn ?? today()) : null,
  };
}

/** Applies the assistant's change fields to a load; unknown names are reported back instead of guessed. */
function applyChanges(st: St, base: Load, i: Record<string, unknown>): { load: LoadInput; problems: string[] } {
  const problems: string[] = [];
  const { id: _id, ...rest } = base;
  void _id;
  let l: LoadInput = { ...rest };
  const set = <K extends keyof LoadInput>(k: K, v: LoadInput[K] | undefined) => { if (v !== undefined) l = { ...l, [k]: v }; };
  for (const [k, f] of [['rate', 'rate'], ['detention', 'detention'], ['layover', 'layover'], ['tonu', 'tonu'], ['other', 'other'], ['lumper', 'lumper']] as const) {
    const v = num(i[k]); if (v !== undefined) set(f, Math.max(0, Math.round(v * 100) / 100));
  }
  const lm = num(i.loaded_miles); if (lm !== undefined) set('loadedMiles', Math.max(0, Math.round(lm)));
  const em = num(i.empty_miles); if (em !== undefined) set('emptyMiles', Math.max(0, Math.round(em)));
  if (str(i.broker)) set('broker', str(i.broker));
  if (str(i.broker_mc)) set('brokerMc', str(i.broker_mc).replace(/\D/g, '').slice(0, 8));
  if (str(i.load_number)) set('pro', str(i.load_number, 60));
  if (str(i.origin)) set('origin', str(i.origin));
  if (str(i.destination)) set('destination', str(i.destination));
  if (isDate(i.date)) set('date', i.date as string);
  if (typeof i.notes === 'string') set('notes', [base.notes, i.notes.trim()].filter(Boolean).join(base.notes ? ' · ' : '').slice(0, 1000));
  const who = [
    ['carrier', 'carrierId', idByName(st.carriers, i.carrier, (c) => [c.name, c.mc])],
    ['truck', 'truckId', idByName(st.trucks, String(i.truck ?? '').replace(/^#/, ''), (t) => [t.unit, t.driver])],
    ['dispatcher', 'dispatcherId', idByName(st.dispatchers, i.dispatcher, (d) => [d.name])],
  ] as const;
  for (const [label, field, id] of who) {
    if (id === null) problems.push(`no ${label} called "${String(i[label])}" on the board`);
    else if (id !== undefined) set(field, id);
  }
  if (l.truckId != null && i.carrier === undefined) {
    const t = st.trucks.find((x) => x.id === l.truckId);
    if (t?.carrierId != null) set('carrierId', t.carrierId);
  }
  if (typeof i.status === 'string' && (LOAD_STATUSES as readonly string[]).includes(i.status)) l = { ...l, ...withStatus(base, i.status as LoadStatus) };
  if (isDate(i.invoiced_on)) set('invoicedOn', i.invoiced_on as string);
  if (isDate(i.paid_on)) { set('paidOn', i.paid_on as string); l = { ...l, status: 'paid', invoicedOn: l.invoicedOn ?? (i.paid_on as string) }; }
  return { load: l, problems };
}

const BLANK: Load = {
  id: 0, date: today(), carrierId: null, dispatcherId: null, broker: '', pro: '', origin: '', destination: '', rate: 0, notes: '', status: 'booked',
  truckId: null, loadedMiles: 0, emptyMiles: 0, detention: 0, layover: 0, tonu: 0, other: 0, lumper: 0, invoicedOn: null, paidOn: null, brokerMc: '',
};

/** One line the user confirms: what exactly will happen. */
function summary(st: St, tool: string, i: Record<string, unknown>): string {
  const lane = (o: unknown, d: unknown) => `${str(o) || '—'} → ${str(d) || '—'}`;
  if (tool === 'create_load') {
    return `Add load: ${str(i.broker) || 'broker?'}${str(i.load_number) ? ` #${str(i.load_number)}` : ''}, ${lane(i.origin, i.destination)}, pickup ${str(i.date) || 'today'}, ${usd(num(i.rate) ?? 0)}`
      + [str(i.carrier) && `carrier ${str(i.carrier)}`, str(i.truck) && `truck ${str(i.truck)}`, str(i.dispatcher) && `dispatcher ${str(i.dispatcher)}`].filter(Boolean).map((x) => `, ${x}`).join('');
  }
  if (tool === 'update_load') {
    const l = st.loads.find((x) => x.id === num(i.id));
    const what = Object.entries(i).filter(([k]) => k !== 'id').map(([k, v]) => `${k.replace(/_/g, ' ')} → ${typeof v === 'number' && /rate|detention|layover|tonu|other|lumper/.test(k) ? usd(v) : String(v)}`);
    return `Change load ${l ? `${l.broker || '#' + l.id} (${lane(l.origin, l.destination)}, ${l.date})` : `#${String(i.id)}`}: ${what.join(', ') || 'nothing'}`;
  }
  if (tool === 'send_invoice') {
    const l = st.loads.find((x) => x.id === num(i.load_id));
    const to = str(i.to) || (l ? st.brokerEmails[lc(l.broker)] : '') || 'the broker (no email known yet)';
    return `Email the invoice for ${l ? `${l.broker} ${lane(l.origin, l.destination)}, ${usd(gross(l) + l.lumper)}` : `load #${String(i.load_id)}`} to ${to}${i.attach_documents === false ? '' : ', with the load documents'}`;
  }
  if (tool === 'add_carrier') return `Add carrier ${str(i.name)}${str(i.mc) ? `, MC ${str(i.mc)}` : ''}${num(i.fee_percent) ? `, fee ${num(i.fee_percent)}%` : num(i.fee_weekly) ? `, fee $${num(i.fee_weekly)}/week` : ''}`;
  return tool;
}

/** Runs a lookup tool: the data for the model and a card for the user. */
async function runRead(ctx: AgentCtx, st: St, name: string, i: Record<string, unknown>): Promise<{ data: unknown; card?: Card }> {
  if (name === 'find_loads') {
    const ls = findLoads(st, i);
    const limit = Math.min(200, Math.max(1, num(i.limit) ?? 50));
    return { data: { ...totals(ls), loads: ls.slice(0, limit).map((l) => row(st, l)), shown: Math.min(limit, ls.length) }, card: { type: 'loads', title: `${ls.length} ${ls.length === 1 ? 'load' : 'loads'} · ${usd(totals(ls).gross)}`, ids: ls.slice(0, 200).map((l) => l.id) } };
  }
  if (name === 'summarize') return summarize(st, i);
  if (name === 'get_load') {
    const l = st.loads.find((x) => x.id === num(i.id));
    if (!l) return { data: { error: `No load #${String(i.id)} on this board` } };
    const files = st.files.filter((f) => f.loadId === l.id).map((f) => ({ id: f.id, kind: f.kind, name: f.name }));
    const inv = st.invoices.find((x) => x.loadId === l.id);
    const check = l.brokerMc ? st.checks.find((c) => c.role === 'broker' && String(c.mc) === l.brokerMc) : undefined;
    return { data: { ...row(st, l), detention: l.detention, layover: l.layover, tonu: l.tonu, other: l.other, lumper: l.lumper, notes: l.notes, documents: files, invoice: inv ?? null, broker_check: check?.summary ?? null }, card: { type: 'loads', title: `Load #${l.id}`, ids: [l.id] } };
  }
  if (name === 'check_company') {
    const c = await ctx.check(str(i.mc), i.role === 'carrier' ? 'carrier' : 'broker');
    return c ? { data: c, card: { type: 'check', check: c } } : { data: { error: `No company with MC ${str(i.mc)} in FMCSA records` } };
  }
  if (name === 'lookup_company') return { data: { results: await ctx.lookup(str(i.query)) } };
  if (name === 'route_miles') {
    const r = await ctx.lane(str(i.from), str(i.to));
    return r ? { data: r, card: { type: 'route', from: str(i.from), to: str(i.to), miles: r.miles, hours: r.hours } } : { data: { error: 'Could not find one of the places on the map — use "City, ST"' } };
  }
  if (name === 'tracking_link') {
    const url = await ctx.trackingLink(num(i.load_id) ?? 0);
    return { data: { url }, card: { type: 'link', label: 'Tracking link for the broker', url } };
  }
  return { data: { error: `Unknown tool ${name}` } };
}

/** Runs a confirmed action. */
async function runWrite(ctx: AgentCtx, st: St, t: Thread, name: string, i: Record<string, unknown>): Promise<{ data: unknown; card?: Card }> {
  if (name === 'create_load') {
    const { load, problems } = applyChanges(st, { ...BLANK, date: isDate(i.date) ? (i.date as string) : today() }, i);
    const saved = await ctx.createLoad(load);
    if (t.file) {
      await ctx.attachFile(saved.id, t.file.name, t.file.mime, Buffer.from(t.file.data, 'base64')).catch(() => undefined);
      t.file = null;
    }
    return { data: { created: row(st, saved), problems }, card: { type: 'loads', title: 'Load added', ids: [saved.id] } };
  }
  if (name === 'update_load') {
    const base = st.loads.find((x) => x.id === num(i.id));
    if (!base) return { data: { error: `No load #${String(i.id)} on this board` } };
    const { load, problems } = applyChanges(st, base, i);
    const saved = await ctx.updateLoad(base.id, load);
    return saved ? { data: { updated: row(st, saved), problems }, card: { type: 'loads', title: 'Load updated', ids: [saved.id] } } : { data: { error: 'Load not found' } };
  }
  if (name === 'send_invoice') {
    const l = st.loads.find((x) => x.id === num(i.load_id));
    if (!l) return { data: { error: `No load #${String(i.load_id)} on this board` } };
    const to = str(i.to) || st.brokerEmails[lc(l.broker)] || '';
    if (!to) return { data: { error: 'No billing email for this broker yet — ask the user for it' } };
    const attach = i.attach_documents === false ? [] : st.files.filter((f) => f.loadId === l.id && f.kind !== 'invoice').map((f) => f.id);
    const r = await ctx.sendInvoice(l.id, to, attach);
    return { data: { sent: true, number: r.number, to, documents: attach.length }, card: { type: 'note', text: `Invoice ${r.number} sent to ${to}` } };
  }
  if (name === 'add_carrier') {
    const pctFee = num(i.fee_percent), weekly = num(i.fee_weekly);
    const c = await ctx.addCarrier({
      name: str(i.name), mc: str(i.mc).replace(/\D/g, ''), dot: '', phone: str(i.phone), email: str(i.email), notes: '',
      feeType: weekly && !pctFee ? 'flat' : 'percent', fee: weekly && !pctFee ? weekly : (pctFee ?? 0), factoring: str(i.factoring),
    });
    return { data: { added: { id: c.id, name: c.name, mc: c.mc } }, card: { type: 'note', text: `Carrier ${c.name} added` } };
  }
  return { data: { error: `Unknown action ${name}` } };
}

const asResult = (id: string, data: unknown, isError = false): ToolResult =>
  ({ type: 'tool_result', tool_use_id: id, content: JSON.stringify(data).slice(0, 60_000), ...(isError ? { is_error: true } : {}) });

/** The model's turns until it answers, or until it proposes actions the user must confirm. */
async function loop(ctx: AgentCtx, t: Thread, board: string) {
  for (let step = 0; step < 10; step++) {
    let r: Anthropic.Beta.BetaMessage;
    try {
      r = await api().beta.messages.create({
        model: MODEL, max_tokens: 8000, betas: BETAS, fallbacks: 'default', output_config: { effort: 'medium' },
        system: [{ type: 'text', text: SYSTEM }, { type: 'text', text: board, cache_control: { type: 'ephemeral' } }],
        tools: TOOLS, messages: t.messages,
      });
    } catch (e) {
      throw friendly(e);
    }
    t.messages.push({ role: 'assistant', content: r.content });
    const text = r.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n').trim();
    const item: DisplayItem = { role: 'assistant', ...(text ? { text } : {}), cards: [] };
    if (r.stop_reason === 'refusal') {
      t.display.push({ role: 'assistant', text: 'I can’t help with that one — ask me about your loads, money, carriers, trucks or dispatchers.' });
      return;
    }
    const uses = r.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    if (r.stop_reason !== 'tool_use' || !uses.length) {
      if (text) t.display.push({ role: 'assistant', text });
      return;
    }
    const st = await ctx.state();
    const results: ToolResult[] = [];
    for (const u of uses.filter((x) => !WRITE_TOOLS.has(x.name))) {
      try {
        const out = await runRead(ctx, st, u.name, (u.input ?? {}) as Record<string, unknown>);
        results.push(asResult(u.id, out.data));
        if (out.card) item.cards!.push(out.card);
      } catch (e) {
        results.push(asResult(u.id, { error: (e as Error).message }, true));
      }
    }
    const writes = uses.filter((x) => WRITE_TOOLS.has(x.name));
    if (writes.length) {
      t.pending = writes.map((u) => ({ id: u.id, tool: u.name, input: (u.input ?? {}) as Record<string, unknown>, summary: summary(st, u.name, (u.input ?? {}) as Record<string, unknown>), status: 'pending' }));
      t.readResults = results;
      item.pending = t.pending.map((p) => p.id);
      t.display.push(item);
      return;
    }
    if (item.text || item.cards!.length) t.display.push(item);
    t.messages.push({ role: 'user', content: results });
  }
  t.display.push({ role: 'assistant', text: 'That took too many steps — try asking in smaller parts.' });
}

/** Results for every pending action (done, declined or failed), with the lookups made in the same turn. */
function closePending(t: Thread): ToolResult[] {
  const out = [...t.readResults, ...t.pending.map((p) =>
    asResult(p.id, p.status === 'done' ? JSON.parse(p.result ?? '{}') : p.status === 'failed' ? { error: p.result } : { declined: 'The user did not confirm this action. Do not do it.' }, p.status === 'failed'))];
  t.pending = [];
  t.readResults = [];
  return out;
}

export interface ChatInput { text: string; file?: { name: string; mime: string; data: Buffer } | null; loadId?: number | null }

/** A new message from the user (any unconfirmed actions count as declined). */
export async function chat(ctx: AgentCtx, t: Thread, board: string, input: ChatInput): Promise<void> {
  const blocks: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (t.pending.length) {
    for (const p of t.pending) if (p.status === 'pending') p.status = 'declined';
    blocks.push(...closePending(t));
  }
  if (input.file) {
    const b64 = input.file.data.toString('base64');
    blocks.push(input.file.mime === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 }, title: input.file.name }
      : { type: 'image', source: { type: 'base64', media_type: input.file.mime === 'image/png' ? 'image/png' : 'image/jpeg', data: b64 } });
    t.file = { name: input.file.name, mime: input.file.mime, data: b64 };
  }
  if (input.loadId) blocks.push({ type: 'text', text: `(Context: the user has load #${input.loadId} open on the board.)` });
  blocks.push({ type: 'text', text: input.text || (input.file ? 'Here is a document.' : '…') });
  t.messages.push({ role: 'user', content: blocks });
  t.display.push({ role: 'user', text: input.text, ...(input.file ? { file: input.file.name } : {}) });
  await loop(ctx, t, board);
}

/** The user confirmed or declined one proposed action; once all are decided, the assistant continues. */
export async function decide(ctx: AgentCtx, t: Thread, board: string, actionId: string, approve: boolean): Promise<void> {
  const p = t.pending.find((x) => x.id === actionId && x.status === 'pending');
  if (!p) return;
  if (approve) {
    try {
      const st = await ctx.state();
      const out = await runWrite(ctx, st, t, p.tool, p.input);
      const err = (out.data as { error?: string }).error;
      p.status = err ? 'failed' : 'done';
      p.result = err ?? JSON.stringify(out.data);
      if (out.card && !err) t.display.push({ role: 'assistant', cards: [out.card] });
    } catch (e) {
      p.status = 'failed';
      p.result = (e as Error).message;
    }
  } else {
    p.status = 'declined';
  }
  if (t.pending.some((x) => x.status === 'pending')) return;
  t.messages.push({ role: 'user', content: closePending(t) });
  await loop(ctx, t, board);
}

/** Short board context for the system prompt (names only; numbers come from the tools). */
export function boardContext(st: St, me: { role: string }): string {
  return [
    `Company: ${st.company.name || '—'}. Today: ${today()}. The user is the ${me.role === 'dispatcher' ? 'dispatcher (sees only their own loads)' : 'owner of the board'}.`,
    `Board: ${st.loads.length} loads.`,
    `Carriers: ${st.carriers.map((c) => `${c.name}${c.mc ? ` (MC ${c.mc})` : ''}`).join('; ') || 'none'}.`,
    `Trucks: ${st.trucks.map((x) => `#${x.unit || '—'} ${x.driver}`.trim()).join('; ') || 'none'}.`,
    `Dispatchers: ${st.dispatchers.map((d) => `${d.name} ${d.percent}%`).join('; ') || 'none'}.`,
  ].join('\n');
}
