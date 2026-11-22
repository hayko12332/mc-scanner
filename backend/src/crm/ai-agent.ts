import type Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'node:crypto';
import { api, friendly, modelParams } from './ai.js';
import type { CompanyCheck } from './company-check.js';
import type { CarrierInput, LoadInput } from './crm.store.js';
import type { CrmCarrier, CrmState, Load, LoadStatus } from './crm.types.js';
import { LOAD_STATUSES } from './crm.types.js';

// The AI is the board's main screen: it works the board with tools (loads, totals, FMCSA checks, miles), shows
// results as cards, and does the work itself. Board changes (new load, status, money, new carrier) run right away
// and can be undone; emails to brokers (invoices) wait for the user's OK. Every step is streamed to the screen as it
// happens (`emit`). The conversation is kept on the server, with the model's own blocks passed back unchanged.

type Msg = Anthropic.Beta.BetaMessageParam;
type ToolResult = Anthropic.Beta.BetaToolResultBlockParam;

export type Card =
  | { type: 'loads'; title: string; ids: number[] }
  | { type: 'table'; title: string; columns: string[]; rows: (string | number)[][] }
  | { type: 'kpis'; items: { label: string; value: string; sub?: string }[] }
  | { type: 'bars'; title: string; rows: { label: string; value: number; text: string }[] }
  | { type: 'check'; check: CompanyCheck }
  | { type: 'route'; from: string; to: string; miles: number; hours: number }
  | { type: 'link'; label: string; url: string }
  | { type: 'note'; text: string };

/** One thing the assistant did, for the live plan above its answer. Old chats stored plain strings. */
export interface Step { label: string; detail?: string; ms?: number; state: 'done' | 'error' | 'waiting' }

/**
 * One message in the chat. An assistant message covers a whole request: the steps it took, its answer, the cards it
 * showed, the changes it made (`actions`, undoable) and the ones waiting for an OK (`pending`).
 */
export interface DisplayItem { role: 'user' | 'assistant'; text?: string; file?: string; cards?: Card[]; pending?: string[]; actions?: string[]; steps?: (string | Step)[]; stopped?: boolean }

type Undo = { kind: 'delete_load'; id: number } | { kind: 'restore_load'; id: number; before: LoadInput } | { kind: 'archive_carrier'; id: number };
export interface PendingAction {
  id: string; tool: string; input: Record<string, unknown>; summary: string;
  status: 'pending' | 'done' | 'declined' | 'failed' | 'undone'; result?: string;
  /** How to take a change back (actions the assistant ran by itself). */
  undo?: Undo;
  /** What an email will look like, for the OK card. */
  preview?: { to: string; subject: string; lines: string[] };
}

export interface Thread {
  id: string;
  /** The first question, shown in the chat history. */
  title?: string;
  createdAt?: string;
  messages: Msg[];
  display: DisplayItem[];
  /** Actions waiting for the user's OK (emails). */
  pending: PendingAction[];
  /** Changes the assistant made by itself; each can be undone. */
  actions?: PendingAction[];
  /** Results of tools from the turn of the pending actions (or a stopped turn), sent back with the next message. */
  readResults: ToolResult[];
  /** Things the model should know at the next message ("the user undid …"). */
  notes?: string[];
  /** A file sent in this chat (e.g. a rate con), attached to the load the assistant creates from it. */
  file?: { name: string; mime: string; data: string } | null;
}

export const newThread = (): Thread => ({ id: randomUUID(), createdAt: new Date().toISOString(), messages: [], display: [], pending: [], actions: [], readResults: [], file: null });

/** What the screen gets while the assistant works. */
export type AgentEvent =
  | { type: 'thinking' }
  | { type: 'step'; id: string; label: string; state: 'running' | Step['state']; detail?: string; ms?: number }
  | { type: 'text'; delta: string }
  | { type: 'card'; card: Card }
  | { type: 'action'; action: ActionView };
export type Emit = (e: AgentEvent) => void;
export type ActionView = Pick<PendingAction, 'id' | 'tool' | 'summary' | 'status' | 'preview'> & { undoable: boolean };
export const actionView = (a: PendingAction): ActionView => ({ id: a.id, tool: a.tool, summary: a.summary, status: a.status, preview: a.preview, undoable: a.status === 'done' && !!a.undo });
const noEmit: Emit = () => undefined;

/** What the assistant is doing right now, for the running step. */
function runningLabel(name: string, i: Record<string, unknown>): string {
  if (name === 'find_loads') return 'Searching your loads';
  if (name === 'summarize') return `Totaling ${i.group_by && i.group_by !== 'none' ? `by ${String(i.group_by)}` : 'the period'}`;
  if (name === 'get_load') return `Opening load #${String(i.id)}`;
  if (name === 'check_company') return `Checking MC ${String(i.mc)} with FMCSA`;
  if (name === 'lookup_company') return `Looking up “${String(i.query)}” in FMCSA`;
  if (name === 'route_miles') return `Routing ${String(i.from)} → ${String(i.to)}`;
  if (name === 'tracking_link') return 'Making a tracking link';
  if (name === 'fleet_status') return 'Checking where the trucks are';
  if (name === 'create_load') return 'Adding the load';
  if (name === 'update_load') return `Updating load #${String(i.id)}`;
  if (name === 'add_carrier') return `Adding carrier ${String(i.name ?? '')}`;
  if (name === 'send_invoice') return 'Preparing the invoice email';
  if (name === 'send_to_factoring') return 'Preparing the factoring packet';
  if (name === 'email_broker') return `Writing to ${String(i.to ?? 'the broker')}`;
  return name.replace(/_/g, ' ');
}

/** What the assistant did, in a few words, and what it found, for the plan above its answer. */
function stepDone(name: string, i: Record<string, unknown>, data: unknown): { label: string; detail?: string } {
  const d = (data ?? {}) as Record<string, unknown>;
  if (d.error) return { label: runningLabel(name, i), detail: String(d.error).slice(0, 140) };
  if (name === 'find_loads') return { label: 'Searched your loads', detail: `${d.count ?? 0} found${d.gross ? ` · ${usd(Number(d.gross))}` : ''}${d.rpm ? ` · $${Number(d.rpm).toFixed(2)}/mi` : ''}` };
  if (name === 'summarize') return { label: `Totaled ${i.group_by && i.group_by !== 'none' ? `by ${String(i.group_by)}` : 'the period'}`, detail: String(d.period ?? '') };
  if (name === 'get_load') return { label: `Opened load #${String(i.id)}`, detail: [d.broker, d.origin && `${String(d.origin)} → ${String(d.destination)}`].filter(Boolean).join(' · ') };
  if (name === 'check_company') return { label: `Checked MC ${String(i.mc)} with FMCSA`, detail: String((d as { summary?: string }).summary ?? '') };
  if (name === 'lookup_company') return { label: `Looked up “${String(i.query)}” in FMCSA`, detail: `${(d.results as unknown[] | undefined)?.length ?? 0} found` };
  if (name === 'route_miles') return { label: `Routed ${String(i.from)} → ${String(i.to)}`, detail: d.miles ? `${Number(d.miles).toLocaleString('en-US')} mi · ~${Math.round(Number(d.hours))} h` : undefined };
  if (name === 'tracking_link') return { label: 'Made a tracking link' };
  if (name === 'fleet_status') return { label: 'Checked the fleet', detail: Array.isArray(d.trucks) ? `${d.trucks.length} ${d.trucks.length === 1 ? 'truck' : 'trucks'}` : undefined };
  if (name === 'create_load') return { label: 'Added the load', detail: str(i.broker) && `${str(i.broker)} · ${str(i.origin)} → ${str(i.destination)}` };
  if (name === 'update_load') return { label: `Updated load #${String(i.id)}`, detail: Object.keys(i).filter((k) => k !== 'id').map((k) => k.replace(/_/g, ' ')).join(', ') };
  if (name === 'add_carrier') return { label: `Added carrier ${str(i.name)}` };
  if (name === 'send_invoice') return { label: 'Sent the invoice', detail: d.to ? `to ${String(d.to)}` : undefined };
  if (name === 'send_to_factoring') return { label: `Sent to ${String(d.factor ?? 'factoring')}`, detail: d.to ? String(d.to) : undefined };
  if (name === 'email_broker') return { label: `Emailed ${String(d.to ?? i.to ?? 'the broker')}` };
  return { label: name.replace(/_/g, ' ') };
}

/** What the assistant may use: the board as this person sees it and the board's own actions. */
export interface AgentCtx {
  state(): Promise<Omit<CrmState, 'user'> & { company: { name: string } }>;
  check(mc: string, role: 'broker' | 'carrier'): Promise<CompanyCheck | null>;
  lookup(query: string): Promise<Record<string, unknown>[]>;
  lane(from: string, to: string): Promise<{ miles: number; hours: number } | null>;
  createLoad(l: LoadInput): Promise<Load>;
  updateLoad(id: number, l: LoadInput): Promise<Load | null>;
  sendInvoice(loadId: number, to: string, attach: number[]): Promise<{ number: string }>;
  /** The invoice packet to the load's carrier's factoring company (its saved email unless `to` is given). */
  sendFactoring(loadId: number, attach: number[], to?: string): Promise<{ number: string; to: string; factor: string }>;
  /** An email to a broker, written by the assistant; signed with the user's name and company, replies go to the user. */
  emailBroker(to: string, subject: string, body: string): Promise<{ to: string }>;
  addCarrier(c: CarrierInput): Promise<CrmCarrier>;
  trackingLink(loadId: number): Promise<string>;
  attachFile(loadId: number, name: string, mime: string, data: Buffer): Promise<unknown>;
  /** For Undo. */
  deleteLoad(id: number): Promise<void>;
  archiveCarrier(id: number): Promise<void>;
}

/** Board changes the assistant makes by itself (each can be undone). */
const AUTO_TOOLS = new Set(['create_load', 'update_load', 'add_carrier']);
/** Actions that leave the board (emails) and wait for the user's OK. */
const CONFIRM_TOOLS = new Set(['send_invoice', 'send_to_factoring', 'email_broker']);
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

const TOOL_DEFS: Anthropic.Beta.BetaTool[] = [
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
    name: 'fleet_status',
    description: 'Where each truck is right now and its driver’s hours of service left (drive, shift, 70-hour cycle, time to the 30-min break), from the connected ELD (Samsara/Motive) or the driver’s Telegram location; plus the load each truck is on. Use for “where is truck 101”, “who can take a load from Dallas tomorrow”, “who is running out of hours”. Shown as a table card.',
    input_schema: obj({ truck: { type: 'string', description: 'Unit number or driver name; empty = all trucks' } }),
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
    name: 'send_to_factoring',
    description: 'Send the invoice packet of a load to its carrier’s factoring company: one PDF with the invoice (remit to the factor) and the load documents (rate con, BOL, POD), to the factor’s email saved on the carrier. Use when the carrier factors (carrier has a factoring company) instead of send_invoice. The user confirms it first. If the carrier has no factoring email yet, pass `to` from the user.',
    input_schema: obj({ load_id: N, to: { type: 'string', description: 'Factoring company email for invoices (only if not saved yet)' }, attach_documents: { type: 'boolean' } }, ['load_id']),
  },
  {
    name: 'email_broker',
    description: 'Email a broker from the user’s company — e.g. about a load the user found on a load board (they paste the posting or send a screenshot): ask if it’s still available and the rate, offer the truck (where and when it’s empty, equipment), or counter a rate. One call per broker; call it several times for several postings. Write a short, professional plain-text body (2–6 sentences, no signature — the user’s name, company, MC and phone are added). Include the load reference (origin → destination, pickup date, posting/reference #) so the broker knows which load. The user sees each email and sends it.',
    input_schema: obj({
      to: { type: 'string', description: 'Broker email from the posting' }, subject: { type: 'string', description: 'e.g. "Load Dallas, TX → Atlanta, GA 11/24 — truck available"' },
      body: { type: 'string', description: 'The message, without greeting signature' },
    }, ['to', 'subject', 'body']),
  },
  {
    name: 'add_carrier',
    description: 'Add a carrier to the board. The user confirms it first.',
    input_schema: obj({ name: S, mc: S, phone: S, email: S, fee_percent: N, fee_weekly: N, factoring: S }, ['name']),
  },
];
/** Tool inputs stream as they are generated; they are checked here before anything runs (`invalidInput`). */
export const TOOLS: Anthropic.Beta.BetaTool[] = TOOL_DEFS.map((t) => ({ ...t, eager_input_streaming: true }));

/** A tool input that misses a required field or has the wrong kind of value (it may have been cut off). */
export function invalidInput(name: string, input: unknown): string | null {
  const def = TOOL_DEFS.find((t) => t.name === name);
  if (!def) return `Unknown tool ${name}`;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'The input is not an object';
  const i = input as Record<string, unknown>;
  const schema = def.input_schema as { properties?: Record<string, { type?: string }>; required?: string[] };
  for (const k of schema.required ?? []) if (i[k] === undefined || i[k] === null || i[k] === '') return `Missing ${k}`;
  for (const [k, v] of Object.entries(i)) {
    const want = schema.properties?.[k]?.type;
    if (!want || v === null) continue;
    if (want === 'number' && num(v) === undefined) return `${k} must be a number`;
    if (want === 'string' && typeof v !== 'string') return `${k} must be text`;
    if (want === 'boolean' && typeof v !== 'boolean') return `${k} must be true or false`;
    if (want === 'array' && !Array.isArray(v)) return `${k} must be a list`;
  }
  return null;
}

const SYSTEM = `You are HaulPanel's assistant inside a dispatch company's TMS board. You work the board for the user: find and total their loads, check brokers and carriers with FMCSA, get miles, and prepare actions (create or change loads, mark paid, send invoices, add carriers).

Rules:
- Get every number from the tools; never guess or invent loads, amounts or companies. If the data isn't there, say what's missing.
- Do the work, don't ask permission: board changes (create_load, update_load, add_carrier) run right away and the user can undo each one. Emails (send_invoice, send_to_factoring, email_broker) are shown to the user and sent only after their OK — call the tool, don't ask in text. Batch several actions in one turn when the user asks for several.
- Invoices: if the load's carrier uses a factoring company, the packet goes to the factor (send_to_factoring), not to the broker, unless the user says otherwise.
- Load boards: you cannot search DAT, Truckstop or other load boards yourself and must never say you did. When the user pastes postings or sends a screenshot of a load board, read every posting (broker, email, lane, date, rate, ref #) and write each broker with email_broker; use fleet_status to say where the truck is and when it's empty if it helps. Postings without an email: list them with their phone so the user can call.
- Don't narrate before using tools ("Let me check…"); the user sees each step live. Write the answer once the work is done.
- Start the answer with one bold line that says the result ("**3 invoices ready — $6,450.**"), then the 1–3 key numbers or reasons, then what to do next if useful. Tool results appear to the user as cards (load lists, tables, charts, checks, maps); don't repeat them row by row.
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

function summarize(st: St, i: Record<string, unknown>): { data: unknown; card: Card; extra: Card[] } {
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
  const all = totals(ls);
  const extra: Card[] = [{
    type: 'kpis', items: [
      { label: 'Gross', value: usd(all.gross), sub: period },
      { label: 'Loads', value: String(all.count) },
      { label: 'Rate per mile', value: all.rpm ? `$${all.rpm.toFixed(2)}` : '—', sub: all.all_in_rpm ? `all-in $${all.all_in_rpm.toFixed(2)}` : undefined },
      { label: 'Empty miles', value: all.loaded_miles + all.empty_miles ? `${Math.round((all.empty_miles / (all.loaded_miles + all.empty_miles)) * 100)}%` : '—' },
    ],
  }];
  if (by !== 'none' && rows.length > 1) {
    const shown = (by === 'week' ? [...rows].reverse() : rows).slice(-12).slice(0, 12);
    extra.push({ type: 'bars', title: `Gross by ${by}`, rows: shown.map((r) => ({ label: r.group, value: r.gross, text: usd(r.gross) })) });
  }
  return {
    data: { period, group_by: by, rows: rows.slice(0, 60) },
    extra,
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
  if (tool === 'send_to_factoring') {
    const l = st.loads.find((x) => x.id === num(i.load_id));
    const c = l ? st.carriers.find((x) => x.id === l.carrierId) : undefined;
    return `Send the invoice packet for ${l ? `${l.broker} ${lane(l.origin, l.destination)}, ${usd(gross(l) + l.lumper)}` : `load #${String(i.load_id)}`} to ${c?.factoring || 'the factoring company'}${str(i.to) || c?.factoringEmail ? ` (${str(i.to) || c?.factoringEmail})` : ''}`;
  }
  if (tool === 'email_broker') return `Email ${str(i.to)}: ${str(i.subject)}`;
  if (tool === 'add_carrier') return `Add carrier ${str(i.name)}${str(i.mc) ? `, MC ${str(i.mc)}` : ''}${num(i.fee_percent) ? `, fee ${num(i.fee_percent)}%` : num(i.fee_weekly) ? `, fee $${num(i.fee_weekly)}/week` : ''}`;
  return tool;
}

/** Runs a lookup tool: the data for the model and a card for the user. */
async function runRead(ctx: AgentCtx, st: St, name: string, i: Record<string, unknown>): Promise<{ data: unknown; card?: Card; extra?: Card[] }> {
  if (name === 'find_loads') {
    const ls = findLoads(st, i);
    const limit = Math.min(200, Math.max(1, num(i.limit) ?? 50));
    return { data: { ...totals(ls), loads: ls.slice(0, limit).map((l) => row(st, l)), shown: Math.min(limit, ls.length) }, card: { type: 'loads', title: `${ls.length} ${ls.length === 1 ? 'load' : 'loads'} · ${usd(totals(ls).gross)}`, ids: ls.slice(0, 200).map((l) => l.id) } };
  }
  if (name === 'summarize') return summarize(st, i);
  if (name === 'fleet_status') return fleetStatus(st, i);
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

/** Runs a board change or a confirmed email; board changes return how to undo them. */
async function runWrite(ctx: AgentCtx, st: St, t: Thread, name: string, i: Record<string, unknown>): Promise<{ data: unknown; card?: Card; undo?: Undo }> {
  if (name === 'create_load') {
    const { load, problems } = applyChanges(st, { ...BLANK, date: isDate(i.date) ? (i.date as string) : today() }, i);
    const saved = await ctx.createLoad(load);
    if (t.file) {
      await ctx.attachFile(saved.id, t.file.name, t.file.mime, Buffer.from(t.file.data, 'base64')).catch(() => undefined);
      t.file = null;
    }
    return { data: { created: row(st, saved), problems }, card: { type: 'loads', title: 'Load added', ids: [saved.id] }, undo: { kind: 'delete_load', id: saved.id } };
  }
  if (name === 'update_load') {
    const base = st.loads.find((x) => x.id === num(i.id));
    if (!base) return { data: { error: `No load #${String(i.id)} on this board` } };
    const { load, problems } = applyChanges(st, base, i);
    const saved = await ctx.updateLoad(base.id, load);
    const { id: _id, ...before } = base;
    void _id;
    return saved
      ? { data: { updated: row(st, saved), problems }, card: { type: 'loads', title: 'Load updated', ids: [saved.id] }, undo: { kind: 'restore_load', id: base.id, before } }
      : { data: { error: 'Load not found' } };
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
  if (name === 'send_to_factoring') {
    const l = st.loads.find((x) => x.id === num(i.load_id));
    if (!l) return { data: { error: `No load #${String(i.load_id)} on this board` } };
    const attach = i.attach_documents === false ? [] : st.files.filter((f) => f.loadId === l.id && f.kind !== 'invoice').map((f) => f.id);
    const r = await ctx.sendFactoring(l.id, attach, str(i.to) || undefined);
    return { data: { sent: true, number: r.number, to: r.to, factor: r.factor, documents: attach.length }, card: { type: 'note', text: `Invoice ${r.number} sent to ${r.factor} (${r.to})` } };
  }
  if (name === 'email_broker') {
    const r = await ctx.emailBroker(str(i.to, 200), str(i.subject, 200), str(i.body, 4000));
    return { data: { sent: true, to: r.to }, card: { type: 'note', text: `Email sent to ${r.to}` } };
  }
  if (name === 'add_carrier') {
    const pctFee = num(i.fee_percent), weekly = num(i.fee_weekly);
    const c = await ctx.addCarrier({
      name: str(i.name), mc: str(i.mc).replace(/\D/g, ''), dot: '', phone: str(i.phone), email: str(i.email), notes: '',
      feeType: weekly && !pctFee ? 'flat' : 'percent', fee: weekly && !pctFee ? weekly : (pctFee ?? 0), factoring: str(i.factoring),
    });
    return { data: { added: { id: c.id, name: c.name, mc: c.mc } }, card: { type: 'note', text: `Carrier ${c.name} added` }, undo: { kind: 'archive_carrier', id: c.id } };
  }
  return { data: { error: `Unknown action ${name}` } };
}

/** What an email will look like, for the OK card. */
function preview(st: St, tool: string, i: Record<string, unknown>): PendingAction['preview'] {
  if (tool === 'send_invoice') return emailPreview(st, i);
  if (tool === 'email_broker') return { to: str(i.to, 200) || 'no email', subject: str(i.subject, 200), lines: str(i.body, 4000).split(/\n+/).map((x) => x.trim()).filter(Boolean) };
  if (tool === 'send_to_factoring') {
    const l = st.loads.find((x) => x.id === num(i.load_id));
    if (!l) return undefined;
    const c = st.carriers.find((x) => x.id === l.carrierId);
    const docs = i.attach_documents === false ? 0 : st.files.filter((f) => f.loadId === l.id && f.kind !== 'invoice').length;
    return {
      to: str(i.to) || c?.factoringEmail || 'no factoring email yet',
      subject: `Invoice for factoring · ${c?.name ?? 'carrier'}${l.pro ? ` · Load ${l.pro}` : ''} · ${l.broker}`,
      lines: [
        `${c?.factoring || 'Factoring company'} · remit to on the invoice`,
        `${l.broker || 'Broker'} · ${l.origin || '—'} → ${l.destination || '—'} · pickup ${l.date}`,
        `Amount: ${usd(gross(l) + l.lumper)}`,
        docs ? `One PDF: invoice + ${docs} load document${docs === 1 ? '' : 's'}` : 'One PDF: invoice only — no rate con / POD attached yet',
      ],
    };
  }
  return undefined;
}

/** What an invoice email will look like, for the OK card. */
function emailPreview(st: St, i: Record<string, unknown>): PendingAction['preview'] {
  const l = st.loads.find((x) => x.id === num(i.load_id));
  if (!l) return undefined;
  const docs = i.attach_documents === false ? 0 : st.files.filter((f) => f.loadId === l.id && f.kind !== 'invoice').length;
  return {
    to: str(i.to) || st.brokerEmails[lc(l.broker)] || 'no billing email yet',
    subject: `Invoice — ${st.company.name || 'our company'}${l.pro ? `, load ${l.pro}` : ''}`,
    lines: [
      `${l.broker || 'Broker'} · ${l.origin || '—'} → ${l.destination || '—'} · pickup ${l.date}`,
      `Amount due: ${usd(gross(l) + l.lumper)}`,
      docs ? `Attached: invoice PDF + ${docs} load document${docs === 1 ? '' : 's'} (rate con, BOL, POD)` : 'Attached: invoice PDF',
    ],
  };
}

const asResult = (id: string, data: unknown, isError = false): ToolResult =>
  ({ type: 'tool_result', tool_use_id: id, content: JSON.stringify(data).slice(0, 60_000), ...(isError ? { is_error: true } : {}) });

/** The model's turn, streamed: text goes to the screen as it is written. Retries a turn whose tool input didn't parse. */
async function turn(t: Thread, board: string, emit: Emit, signal?: AbortSignal): Promise<Anthropic.Beta.BetaMessage> {
  for (let attempt = 0; ; attempt++) {
    const stream = api().beta.messages.stream({
      ...modelParams(), max_tokens: 8000, output_config: { effort: 'medium' },
      system: [{ type: 'text', text: SYSTEM }, { type: 'text', text: board, cache_control: { type: 'ephemeral' } }],
      tools: TOOLS, messages: t.messages,
    }, { signal });
    stream.on('text', (delta) => emit({ type: 'text', delta }));
    try {
      return await stream.finalMessage();
    } catch (e) {
      // Only a tool input that could not be parsed is worth asking again; API errors and a stop go up.
      if (signal?.aborted || e instanceof Error && 'status' in e || attempt >= 2) throw e;
    }
  }
}

/** The model's turns until it answers or an email waits for the user's OK. Everything is shown live through `emit`. */
async function loop(ctx: AgentCtx, t: Thread, board: string, emit: Emit, signal?: AbortSignal) {
  t.actions ??= [];
  const item: DisplayItem = { role: 'assistant', cards: [], steps: [], actions: [] };
  t.display.push(item);
  const texts: string[] = [];
  const finish = () => {
    const text = texts.join('\n\n').trim();
    if (text) item.text = text;
  };
  const stopped = () => {
    item.stopped = true;
    finish();
    if (!item.text && !item.steps!.length) item.text = 'Stopped.';
  };
  for (let step = 0; step < 12; step++) {
    if (signal?.aborted) return stopped();
    emit({ type: 'thinking' });
    let r: Anthropic.Beta.BetaMessage;
    try {
      if (texts.length) emit({ type: 'text', delta: '\n\n' });
      r = await turn(t, board, emit, signal);
    } catch (e) {
      if (signal?.aborted) {
        // Keep the conversation valid for the next message: the stopped turn becomes a short assistant reply.
        t.messages.push({ role: 'assistant', content: [{ type: 'text', text: '(Stopped by the user.)' }] });
        return stopped();
      }
      finish();
      throw friendly(e);
    }
    t.messages.push({ role: 'assistant', content: r.content });
    const text = r.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n').trim();
    if (text) texts.push(text);
    if (r.stop_reason === 'refusal') {
      texts.push('I can’t help with that one — ask me about your loads, money, carriers, trucks or dispatchers.');
      return finish();
    }
    const uses = r.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    if (r.stop_reason !== 'tool_use' || !uses.length) {
      if (r.stop_reason === 'max_tokens' && uses.length) texts.push('That answer got too long — ask for a smaller part.');
      return finish();
    }
    let st = await ctx.state();
    const results: ToolResult[] = [];
    const confirm: Anthropic.Beta.BetaToolUseBlock[] = [];
    for (const u of uses) {
      const input = (u.input ?? {}) as Record<string, unknown>;
      if (signal?.aborted) { results.push(asResult(u.id, { error: 'Stopped by the user before this ran' }, true)); continue; }
      const bad = invalidInput(u.name, input);
      if (bad) { results.push(asResult(u.id, { error: `Invalid input: ${bad}` }, true)); continue; }
      if (CONFIRM_TOOLS.has(u.name)) { confirm.push(u); continue; }
      emit({ type: 'step', id: u.id, label: runningLabel(u.name, input), state: 'running' });
      const t0 = Date.now();
      try {
        const out = AUTO_TOOLS.has(u.name) ? await runWrite(ctx, st, t, u.name, input) : await runRead(ctx, st, u.name, input);
        const err = (out.data as { error?: string } | null)?.error;
        results.push(asResult(u.id, out.data, !!err));
        const done = stepDone(u.name, input, out.data);
        const s: Step = { ...done, ms: Date.now() - t0, state: err ? 'error' : 'done' };
        item.steps!.push(s);
        emit({ type: 'step', id: u.id, ...s });
        if (AUTO_TOOLS.has(u.name) && !err) {
          const a: PendingAction = { id: u.id, tool: u.name, input, summary: summary(st, u.name, input), status: 'done', result: JSON.stringify(out.data), undo: (out as { undo?: Undo }).undo };
          t.actions.push(a);
          item.actions!.push(a.id);
          emit({ type: 'action', action: actionView(a) });
          st = await ctx.state();
        }
        for (const c of [...(out.card ? [out.card] : []), ...((out as { extra?: Card[] }).extra ?? [])]) {
          item.cards!.push(c);
          emit({ type: 'card', card: c });
        }
      } catch (e) {
        results.push(asResult(u.id, { error: (e as Error).message }, true));
        const s: Step = { label: runningLabel(u.name, input), detail: (e as Error).message.slice(0, 140), ms: Date.now() - t0, state: 'error' };
        item.steps!.push(s);
        emit({ type: 'step', id: u.id, ...s });
      }
    }
    if (signal?.aborted && !confirm.length) {
      // The tool results go with the next message, so the conversation stays valid.
      t.readResults = results;
      return stopped();
    }
    if (confirm.length) {
      t.pending = confirm.map((u) => {
        const input = (u.input ?? {}) as Record<string, unknown>;
        return { id: u.id, tool: u.name, input, summary: summary(st, u.name, input), status: 'pending', preview: preview(st, u.name, input) };
      });
      t.readResults = results;
      item.pending = t.pending.map((p) => p.id);
      for (const p of t.pending) {
        const s: Step = { label: p.tool === 'send_invoice' ? 'Invoice email ready' : p.tool === 'send_to_factoring' ? 'Factoring packet ready' : p.tool === 'email_broker' ? `Email to ${str(p.input.to, 200)} ready` : runningLabel(p.tool, p.input), detail: 'waiting for your OK', state: 'waiting' };
        item.steps!.push(s);
        emit({ type: 'step', id: p.id, ...s });
        emit({ type: 'action', action: actionView(p) });
      }
      return finish();
    }
    t.messages.push({ role: 'user', content: results });
  }
  texts.push('That took too many steps — try asking in smaller parts.');
  finish();
}

/** Results for every pending action (done, declined or failed), with the tool results of the same turn. */
function closePending(t: Thread): ToolResult[] {
  const out = [...t.readResults, ...t.pending.map((p) =>
    asResult(p.id, p.status === 'done' ? JSON.parse(p.result ?? '{}') : p.status === 'failed' ? { error: p.result } : { declined: 'The user did not confirm this action. Do not do it.' }, p.status === 'failed'))];
  t.pending = [];
  t.readResults = [];
  return out;
}

export interface ChatInput { text: string; file?: { name: string; mime: string; data: Buffer } | null; loadId?: number | null }

/** A new message from the user (any unconfirmed emails count as declined). */
export async function chat(ctx: AgentCtx, t: Thread, board: string, input: ChatInput, emit: Emit = noEmit, signal?: AbortSignal): Promise<void> {
  const blocks: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (t.pending.length || t.readResults.length) {
    for (const p of t.pending) if (p.status === 'pending') p.status = 'declined';
    (t.actions ??= []).push(...t.pending);
    blocks.push(...closePending(t));
  }
  if (t.notes?.length) {
    blocks.push({ type: 'text', text: `(Since the last message: ${t.notes.join('; ')}.)` });
    t.notes = [];
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
  t.title ??= (input.text || input.file?.name || 'New chat').slice(0, 80);
  await loop(ctx, t, board, emit, signal);
}

/** The user answered an email waiting for their OK; once all are answered, the assistant continues. */
export async function decide(ctx: AgentCtx, t: Thread, board: string, actionId: string, approve: boolean, emit: Emit = noEmit, signal?: AbortSignal): Promise<void> {
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
  emit({ type: 'action', action: actionView(p) });
  if (t.pending.some((x) => x.status === 'pending')) return;
  // Answered emails stay in the chat with how they ended (sent, not sent, failed).
  (t.actions ??= []).push(...t.pending);
  t.messages.push({ role: 'user', content: closePending(t) });
  await loop(ctx, t, board, emit, signal);
}

const hm = (min: number | null | undefined) => (min == null ? '' : `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`);
const ago = (at: string | null | undefined) => {
  if (!at) return '';
  const m = Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 60_000));
  return m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

/** Every truck: last known place (ELD or Telegram), speed, driver's HOS clocks and the load it's on. */
function fleetStatus(st: St, i: Record<string, unknown>): { data: unknown; card?: Card } {
  const q = lc(str(i.truck).replace(/^#/, ''));
  const trucks = st.trucks.filter((t) => !q || lc(t.unit) === q || lc(t.unit).includes(q) || lc(t.driver).includes(q));
  const rows = trucks.map((t) => {
    const e = st.eld?.find((u) => u.truckId === t.id);
    const p = st.positions?.find((x) => x.truckId === t.id);
    const load = st.loads.find((l) => l.truckId === t.id && (l.status === 'in_transit' || l.status === 'booked'));
    const newest = e?.at && (!p || e.at >= p.at) ? 'eld' : p ? 'telegram' : null;
    return {
      truck: t.unit ? `#${t.unit}` : '—', driver: e?.driver || t.driver,
      where: newest === 'eld' ? e!.address || (e!.lat != null ? `${e!.lat.toFixed(3)}, ${e!.lon!.toFixed(3)}` : '') : newest === 'telegram' ? `${p!.lat.toFixed(3)}, ${p!.lon.toFixed(3)} (driver’s Telegram)` : '',
      updated: ago(newest === 'eld' ? e!.at : p?.at), speed_mph: newest === 'eld' ? e!.speedMph : null,
      duty: e?.hos?.status ?? '', drive_left: hm(e?.hos?.driveLeftMin), shift_left: hm(e?.hos?.shiftLeftMin), cycle_left: hm(e?.hos?.cycleLeftMin), break_in: hm(e?.hos?.breakLeftMin),
      load: load ? `#${load.id} ${load.origin} → ${load.destination} (${load.status})` : '',
    };
  });
  const connected = !!st.eld?.length;
  const data = { trucks: rows, eld_connected: connected, note: connected ? undefined : 'No ELD connected: only drivers’ Telegram locations. The owner can connect Samsara on the Integrations page for live GPS and hours of service.' };
  if (!rows.length) return { data };
  return {
    data,
    card: { type: 'table', title: `Fleet now · ${rows.length} ${rows.length === 1 ? 'truck' : 'trucks'}`, columns: ['Truck', 'Driver', 'Where', 'Updated', 'Duty', 'Drive left', 'Shift left', 'Cycle left', 'Load'],
      rows: rows.map((r) => [r.truck, r.driver, r.where || '—', r.updated || '—', r.duty.replace(/_/g, ' ') || '—', r.drive_left || '—', r.shift_left || '—', r.cycle_left || '—', r.load || '—']) },
  };
}

/** Takes back a change the assistant made by itself; the assistant is told at the next message. */
export async function undo(ctx: AgentCtx, t: Thread, actionId: string): Promise<PendingAction | null> {
  const a = t.actions?.find((x) => x.id === actionId && x.status === 'done' && x.undo);
  if (!a?.undo) return null;
  if (a.undo.kind === 'delete_load') await ctx.deleteLoad(a.undo.id);
  else if (a.undo.kind === 'restore_load') await ctx.updateLoad(a.undo.id, a.undo.before);
  else await ctx.archiveCarrier(a.undo.id);
  a.status = 'undone';
  (t.notes ??= []).push(`the user undid “${a.summary}”`);
  return a;
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
