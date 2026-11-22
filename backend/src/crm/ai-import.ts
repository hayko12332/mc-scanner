import { inflateRawSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { api, FAST_MODEL, friendly, modelParams } from './ai.js';
import { LOAD_STATUSES, type CrmState, type LoadStatus } from './crm.types.js';

// Moving a dispatch office in, the simple way: drop whatever you have — spreadsheets (Excel, CSV, Google Sheets
// export), rate cons, carrier packets, screenshots of the old TMS — and the AI fills the board. For a table the AI
// only reads the first rows and says which column is what; the code then moves every row (fast, exact, cheap).
// Documents and pictures are read by the AI directly. Nothing is saved until the person looks at the preview.

export interface Table { source: string; rows: string[][] }
export interface ImportFile { name: string; data: Buffer }

export interface PlanLoad {
  date: string; broker: string; brokerMc: string; pro: string; origin: string; destination: string; rate: number; loadedMiles: number; emptyMiles: number;
  carrier: string; truck: string; dispatcher: string; status: LoadStatus; invoicedOn: string | null; paidOn: string | null; notes: string;
  source: string; duplicate?: boolean;
}
export interface PlanCarrier { name: string; mc: string; dot: string; phone: string; email: string; feePercent: number; factoring: string; existing?: boolean }
export interface PlanTruck { unit: string; driver: string; phone: string; carrier: string; existing?: boolean }
export interface PlanDispatcher { name: string; percent: number; existing?: boolean }
export interface PlanBroker { name: string; mc: string; email: string }
export interface ImportPlan {
  id: string;
  sources: { name: string; what: string; rows: number }[];
  skipped: { name: string; reason: string }[];
  dispatchers: PlanDispatcher[]; carriers: PlanCarrier[]; trucks: PlanTruck[]; loads: PlanLoad[]; brokers: PlanBroker[];
}

const MAX_ROWS = 3000;
const clean = (v: unknown, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const lc = (v: unknown) => clean(v).toLowerCase();
const digits = (v: unknown, max = 10) => String(v ?? '').replace(/\D/g, '').slice(0, max);
const money = (v: unknown) => {
  const n = Number(String(v ?? '').replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1'));
  return Number.isFinite(n) && Math.abs(n) < 1e8 ? Math.round(n * 100) / 100 : 0;
};
const today = () => new Date().toISOString().slice(0, 10);

// ---------- reading files ----------

/** Excel (.xlsx) is a ZIP of XML files; this reads every sheet's cells as text (dates stay as Excel day numbers). */
export function readXlsx(buf: Buffer): Table[] {
  const files = unzip(buf);
  const xml = (path: string) => files.get(path)?.toString('utf8') ?? '';
  const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&');
  const shared = [...xml('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => unesc([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
  const rels = new Map([...xml('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)].map((m) => [/Id="([^"]+)"/.exec(m[0])?.[1] ?? '', /Target="([^"]+)"/.exec(m[0])?.[1] ?? '']));
  const sheets = [...xml('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)].map((m) => ({
    name: unesc(/name="([^"]*)"/.exec(m[0])?.[1] ?? 'Sheet'),
    path: (() => { const t = rels.get(/r:id="([^"]+)"/.exec(m[0])?.[1] ?? '') ?? ''; return t.startsWith('/') ? t.slice(1) : `xl/${t.replace(/^\.\//, '')}`; })(),
  }));
  const col = (ref: string) => [...(/^[A-Z]+/.exec(ref)?.[0] ?? 'A')].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
  return sheets.map((sh) => {
    const rows: string[][] = [];
    for (const r of xml(sh.path).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const row: string[] = [];
      for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1], body = c[2] ?? '';
        const ref = /r="([A-Z]+)\d+"/.exec(attrs)?.[1];
        const type = /t="([^"]+)"/.exec(attrs)?.[1];
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        const value = type === 's' ? shared[Number(v)] ?? '' : type === 'inlineStr' ? unesc([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')) : unesc(v ?? '');
        row[ref ? col(ref) : row.length] = value;
      }
      rows.push(Array.from(row, (x) => x ?? ''));
      if (rows.length > MAX_ROWS + 50) break;
    }
    return { source: sheets.length > 1 ? sh.name : '', rows: rows.filter((r) => r.some((x) => x.trim())) };
  }).filter((t) => t.rows.length);
}

/** The files inside a ZIP (stored or deflated), from its central directory. */
function unzip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66_000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a ZIP file');
  let p = buf.readUInt32LE(eocd + 16);
  const count = buf.readUInt16LE(eocd + 10);
  for (let n = 0; n < count && p + 46 <= buf.length && buf.readUInt32LE(p) === 0x02014b50; n++) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20), nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32), local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    if (/\.(xml|rels)$/.test(name)) out.set(name, method === 8 ? inflateRawSync(raw, { maxOutputLength: 64 * 1024 * 1024 }) : Buffer.from(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** CSV or TSV text into rows (quotes, commas and line breaks inside quotes handled). */
export function readCsv(text: string): string[][] {
  const first = text.split('\n', 1)[0];
  const sep = (first.match(/\t/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? '\t' : (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"' && !cell) quoted = true;
    else if (ch === sep) { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      if (rows.length > MAX_ROWS + 50) break;
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

export type FileKindIn = 'xlsx' | 'csv' | 'pdf' | 'image' | 'unknown';
export function fileKind(name: string, b: Buffer): FileKindIn {
  if (b.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if ((b[0] === 0xff && b[1] === 0xd8) || b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return 'image';
  if (b.readUInt32LE(0) === 0x04034b50 && b.includes('xl/workbook')) return 'xlsx';
  const head = b.subarray(0, 4000).toString('utf8');
  if (/\.(csv|tsv|txt)$/i.test(name) || (!/[\x00-\x08]/.test(head) && /[,\t;]/.test(head))) return 'csv';
  return 'unknown';
}

// ---------- the AI ----------

const FIELDS = ['date', 'broker', 'broker_mc', 'load_number', 'origin', 'origin_city', 'origin_state', 'destination', 'destination_city', 'destination_state',
  'rate', 'loaded_miles', 'empty_miles', 'carrier', 'truck', 'driver', 'driver_phone', 'dispatcher', 'dispatcher_percent', 'status', 'invoiced_on', 'paid_on',
  'notes', 'name', 'mc', 'dot', 'phone', 'email', 'fee_percent', 'factoring', 'unit', 'billing_email'] as const;
type Field = (typeof FIELDS)[number];

const TableMap = z.object({
  kind: z.enum(['loads', 'carriers', 'trucks', 'dispatchers', 'brokers', 'ignore']).describe('What one row of this table is'),
  what: z.string().describe('A few words for the person, e.g. "Load log, Jan–Nov 2026"'),
  header_row: z.number().int().describe('Index of the header row in the sample (0 if the first row is the header, -1 if there is no header)'),
  columns: z.array(z.object({ field: z.enum(FIELDS), column: z.number().int().describe('0-based column index') }))
    .describe('Only columns that clearly hold one of the fields. For loads: name=nothing; carrier/truck/driver/dispatcher are names on the load row. For carriers: name, mc, dot, phone, email, fee_percent, factoring. For trucks: unit, driver, driver_phone, carrier. For dispatchers: name, dispatcher_percent. For brokers: name, mc, billing_email.'),
  date_order: z.enum(['MDY', 'DMY', 'YMD']).describe('How dates like 03/04/2026 are written in this table (US is MDY)'),
  statuses: z.array(z.object({ value: z.string(), status: z.enum(LOAD_STATUSES) })).describe('Every distinct status word seen in the status column mapped to booked / in_transit / delivered / invoiced / paid'),
});
export type TableMap = z.infer<typeof TableMap>;

const LoadZ = z.object({
  date: z.string().describe('Pickup date YYYY-MM-DD or empty'), broker: z.string(), broker_mc: z.string(), load_number: z.string(),
  origin: z.string().describe('"City, ST"'), destination: z.string().describe('"City, ST"'), rate: z.number(), loaded_miles: z.number(),
  carrier: z.string(), truck: z.string(), driver: z.string(), dispatcher: z.string(),
  status: z.enum([...LOAD_STATUSES, 'unknown']), notes: z.string().describe('Appointments, commodity, weight, references; max 300 chars'),
});
const DocExtract = z.object({
  what: z.string().describe('A few words: what this file is (e.g. "Rate con from TQL", "Carrier packet — ABC Trucking", "Screenshot of a load list")'),
  loads: z.array(LoadZ),
  carriers: z.array(z.object({ name: z.string(), mc: z.string(), dot: z.string(), phone: z.string(), email: z.string(), factoring: z.string() })),
  trucks: z.array(z.object({ unit: z.string(), driver: z.string(), driver_phone: z.string(), carrier: z.string() })),
  dispatchers: z.array(z.object({ name: z.string() })),
  brokers: z.array(z.object({ name: z.string(), mc: z.string(), billing_email: z.string() })),
});
type DocExtract = z.infer<typeof DocExtract>;

/** The first rows of a table → which column is what (the low-cost model reads only a sample). */
export async function mapTable(t: Table, fileName: string): Promise<TableMap> {
  // Each cell carries its column number, so the row number in front can't be taken for column 0.
  const sample = t.rows.slice(0, 25).map((r, i) => `row ${i}: ${r.map((c, j) => `[${j}] ${clean(c, 60)}`).join('  ')}`).join('\n');
  try {
    const r = await api().beta.messages.parse({
      model: FAST_MODEL, max_tokens: 3000,
      output_config: { effort: 'low', format: betaZodOutputFormat(TableMap) },
      messages: [{ role: 'user', content: `A truck dispatch company is moving its data into a TMS. This is a sample of a table from the file "${fileName}"${t.source ? `, sheet "${t.source}"` : ''} (${t.rows.length} rows in all). Each line is one row; every cell is written as [column number] value, starting from [0].\n\n${sample}\n\nSay what one row is and which column holds which field. Leave out columns you are not sure about. In a load log, a \"Company\", \"Company Name\", \"Customer\" or \"Shipper/Broker\" column is the broker (who pays for the load) unless the sheet clearly lists carriers; a column of people's first names next to the rate (often titled with initials) is the dispatcher.` }],
    });
    if (r.stop_reason === 'refusal' || !r.parsed_output) throw new Error('AI could not read this table');
    return r.parsed_output;
  } catch (e) {
    throw friendly(e);
  }
}

/** A PDF or picture → the records in it (the stronger model, since layouts vary a lot). */
async function readDoc(f: ImportFile, kind: 'pdf' | 'image'): Promise<DocExtract> {
  const b64 = f.data.toString('base64');
  const media = f.data[0] === 0x89 ? 'image/png' : 'image/jpeg';
  try {
    const r = await api().beta.messages.parse({
      ...modelParams(), max_tokens: 16000,
      output_config: { effort: 'low', format: betaZodOutputFormat(DocExtract) },
      messages: [{
        role: 'user',
        content: [
          kind === 'pdf' ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 }, title: f.name } : { type: 'image', source: { type: 'base64', media_type: media, data: b64 } },
          { type: 'text', text: `A truck dispatch company is moving its data into a TMS. Take every load, carrier, truck/driver, dispatcher and broker from this file ("${f.name}"). It may be a rate confirmation (one load + the broker), a carrier packet (one carrier), a screenshot or export of another TMS, a list or an invoice. Use only what is printed; leave unknown fields empty or 0. Dates YYYY-MM-DD (today is ${today()}), places "City, ST".` },
        ],
      }],
    });
    if (r.stop_reason === 'refusal' || !r.parsed_output) throw new Error('AI could not read this file');
    return r.parsed_output;
  } catch (e) {
    throw friendly(e);
  }
}

// ---------- rows → plan ----------

/** "03/04/26", "2026-03-04", "Mar 4, 2026" or an Excel day number → YYYY-MM-DD (null if not a date). */
export function toDate(v: unknown, order: 'MDY' | 'DMY' | 'YMD' = 'MDY'): string | null {
  const s = clean(v, 40);
  if (!s) return null;
  const iso = (y: number, m: number, d: number) => {
    if (y < 100) y += 2000;
    const dt = new Date(Date.UTC(y, m - 1, d));
    return y >= 2000 && y <= 2100 && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : null;
  };
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const n = Math.floor(Number(s));
    return n > 36500 && n < 73000 ? new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10) : null;
  }
  const m = /^(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})/.exec(s);
  if (m) {
    const [a, b, c] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (m[1].length === 4) return iso(a, b, c);
    return order === 'DMY' ? iso(c, b, a) : order === 'YMD' ? iso(a, b, c) : iso(c, a, b);
  }
  // "Nov 14th, 2026", "November 14 2026", "14 Nov 2026" — read by hand: Date.parse would use the server's time zone.
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const mon = (w: string) => months.indexOf(w.slice(0, 3).toLowerCase()) + 1;
  const a = /^([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{2,4})\b/i.exec(s);
  if (a && mon(a[1])) return iso(Number(a[3]), mon(a[1]), Number(a[2]));
  const b = /^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?,?\s+(\d{2,4})\b/i.exec(s);
  if (b && mon(b[2])) return iso(Number(b[3]), mon(b[2]), Number(b[1]));
  return null;
}

const place = (city: string, state: string) => cityState([clean(city, 80), clean(state, 20).toUpperCase()].filter(Boolean).join(', '));

const STATES = new Set('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY AB BC MB NB NL NS ON PE QC SK'.split(' '));

/** "FISHERSVILLE, VA 22939", "LOVELAND CO 80537", "Peru, IL, 61354" → "Fishersville, VA", "Loveland, CO", "Peru, IL" (maps and miles need "City, ST"). */
export function cityState(v: string): string {
  const s = clean(v, 120).replace(/[\s,]*\b\d{5}(-\d{4})?\s*$/, '').replace(/[\s,]+$/, '');
  const m = /^(.*?[^\s,])[\s,]+([A-Za-z]{2})$/.exec(s);
  if (!m || !STATES.has(m[2].toUpperCase())) return s;
  const city = m[1] === m[1].toUpperCase() ? m[1].toLowerCase().replace(/(^|[\s.'-])([a-z])/g, (_x, a: string, b: string) => a + b.toUpperCase()) : m[1];
  return `${city.replace(/,$/, '')}, ${m[2].toUpperCase()}`;
}

/**
 * The AI can still be one column off. A date column must hold dates and a rate/miles column numbers: if shifting
 * every column by one fits the rows clearly better, the shifted map is used.
 */
export function fixOffset(t: Table, map: TableMap): TableMap {
  const body = t.rows.slice(map.header_row >= 0 ? map.header_row + 1 : 0, (map.header_row >= 0 ? map.header_row + 1 : 0) + 200);
  const col = (f: Field) => map.columns.find((x) => x.field === f)?.column;
  const checks: [number, (v: string) => boolean][] = [];
  for (const f of ['date', 'invoiced_on', 'paid_on'] as Field[]) { const c = col(f); if (c != null) checks.push([c, (v) => !!toDate(v, map.date_order)]); }
  for (const f of ['rate', 'loaded_miles', 'mc', 'dot', 'fee_percent', 'dispatcher_percent'] as Field[]) { const c = col(f); if (c != null) checks.push([c, (v) => /\d/.test(v) && money(v) > 0]); }
  if (!checks.length) return map;
  const score = (off: number) => body.reduce((n, r) => n + checks.filter(([c, ok]) => ok(clean(r[c + off] ?? '', 80))).length, 0);
  const base = score(0);
  const [best, s] = [-1, 1].map((o) => [o, score(o)] as const).sort((a, b) => b[1] - a[1])[0];
  if (s <= base * 1.5 || s - base < 2) return map;
  return { ...map, columns: map.columns.map((x) => ({ ...x, column: x.column + best })).filter((x) => x.column >= 0) };
}

/** Every row of a mapped table as records. */
export function rowsToRecords(t: Table, mapped: TableMap, source: string) {
  const map = fixOffset(t, mapped);
  const at = (r: string[], f: Field) => { const c = map.columns.find((x) => x.field === f)?.column; return c == null || c < 0 ? '' : clean(r[c] ?? '', 300); };
  const has = (f: Field) => map.columns.some((x) => x.field === f);
  const statusOf = new Map(map.statuses.map((s) => [lc(s.value), s.status]));
  const body = t.rows.slice(map.header_row >= 0 ? map.header_row + 1 : 0, (map.header_row >= 0 ? map.header_row + 1 : 0) + MAX_ROWS);
  const out = { loads: [] as PlanLoad[], carriers: [] as PlanCarrier[], trucks: [] as PlanTruck[], dispatchers: [] as PlanDispatcher[], brokers: [] as PlanBroker[] };
  for (const r of body) {
    if (map.kind === 'loads') {
      const origin = at(r, 'origin') ? cityState(at(r, 'origin')) : place(at(r, 'origin_city'), at(r, 'origin_state'));
      const destination = at(r, 'destination') ? cityState(at(r, 'destination')) : place(at(r, 'destination_city'), at(r, 'destination_state'));
      const date = toDate(at(r, 'date'), map.date_order);
      const rate = money(at(r, 'rate'));
      if (!date || (!origin && !destination && !rate && !at(r, 'broker'))) continue;
      const invoicedOn = toDate(at(r, 'invoiced_on'), map.date_order), paidOn = toDate(at(r, 'paid_on'), map.date_order);
      const raw = statusOf.get(lc(at(r, 'status')));
      const status: LoadStatus = paidOn ? 'paid' : raw ?? (invoicedOn ? 'invoiced' : date < addDays(today(), -3) ? 'delivered' : 'booked');
      out.loads.push({
        date, broker: at(r, 'broker'), brokerMc: digits(at(r, 'broker_mc'), 8), pro: at(r, 'load_number').slice(0, 60), origin, destination, rate,
        loadedMiles: Math.min(20000, Math.round(money(at(r, 'loaded_miles')))), emptyMiles: Math.min(20000, Math.round(money(at(r, 'empty_miles')))),
        carrier: at(r, 'carrier'), truck: at(r, 'truck').replace(/^#/, ''), dispatcher: at(r, 'dispatcher'), status,
        invoicedOn: invoicedOn ?? (status === 'invoiced' || status === 'paid' ? date : null), paidOn, notes: at(r, 'notes').slice(0, 300), source,
      });
      if (at(r, 'driver') && at(r, 'truck')) out.trucks.push({ unit: at(r, 'truck').replace(/^#/, ''), driver: at(r, 'driver'), phone: digits(at(r, 'driver_phone'), 15), carrier: at(r, 'carrier') });
    } else if (map.kind === 'carriers') {
      const name = at(r, 'name') || at(r, 'carrier');
      if (name) out.carriers.push({ name, mc: digits(at(r, 'mc')), dot: digits(at(r, 'dot')), phone: at(r, 'phone').slice(0, 40), email: at(r, 'email').slice(0, 120), feePercent: Math.min(50, Math.max(0, money(at(r, 'fee_percent')))), factoring: at(r, 'factoring').slice(0, 120) });
    } else if (map.kind === 'trucks') {
      const unit = (at(r, 'unit') || at(r, 'truck')).replace(/^#/, '');
      if (unit || at(r, 'driver')) out.trucks.push({ unit, driver: at(r, 'driver') || at(r, 'name'), phone: digits(at(r, 'driver_phone') || at(r, 'phone'), 15), carrier: at(r, 'carrier') });
    } else if (map.kind === 'dispatchers') {
      const name = at(r, 'name') || at(r, 'dispatcher');
      if (name) out.dispatchers.push({ name, percent: Math.min(50, Math.max(0, money(at(r, 'dispatcher_percent')))) });
    } else if (map.kind === 'brokers') {
      const name = at(r, 'name') || at(r, 'broker');
      if (name) out.brokers.push({ name, mc: digits(at(r, 'mc') || at(r, 'broker_mc'), 8), email: at(r, 'billing_email') || at(r, 'email') });
    }
  }
  return out;
}

function addDays(iso: string, n: number) { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

/** Records from a document, in the same shape as table rows. */
function docToRecords(d: DocExtract, source: string) {
  return {
    loads: d.loads.flatMap((l): PlanLoad[] => {
      const date = toDate(l.date, 'YMD');
      if (!date && !l.origin && !l.rate) return [];
      const status: LoadStatus = l.status === 'unknown' ? 'booked' : l.status;
      return [{
        date: date ?? today(), broker: clean(l.broker), brokerMc: digits(l.broker_mc, 8), pro: clean(l.load_number, 60), origin: cityState(l.origin), destination: cityState(l.destination),
        rate: Math.max(0, money(l.rate)), loadedMiles: Math.round(Math.max(0, l.loaded_miles)), emptyMiles: 0, carrier: clean(l.carrier), truck: clean(l.truck).replace(/^#/, ''),
        dispatcher: clean(l.dispatcher), status, invoicedOn: status === 'invoiced' || status === 'paid' ? date : null, paidOn: status === 'paid' ? date : null, notes: clean(l.notes, 300), source,
      }];
    }),
    carriers: d.carriers.filter((c) => clean(c.name)).map((c) => ({ name: clean(c.name), mc: digits(c.mc), dot: digits(c.dot), phone: clean(c.phone, 40), email: clean(c.email, 120), feePercent: 0, factoring: clean(c.factoring, 120) })),
    trucks: d.trucks.filter((t) => clean(t.unit) || clean(t.driver)).map((t) => ({ unit: clean(t.unit, 30).replace(/^#/, ''), driver: clean(t.driver, 80), phone: digits(t.driver_phone, 15), carrier: clean(t.carrier) })),
    dispatchers: d.dispatchers.filter((x) => clean(x.name)).map((x) => ({ name: clean(x.name, 80), percent: 0 })),
    brokers: d.brokers.filter((b) => clean(b.name)).map((b) => ({ name: clean(b.name), mc: digits(b.mc, 8), email: clean(b.billing_email, 120) })),
  };
}

/** Joins everything found, drops repeats, and marks what the board already has. */
export function buildPlan(state: Pick<CrmState, 'loads' | 'carriers' | 'trucks' | 'dispatchers'>, parts: ReturnType<typeof rowsToRecords>[], sources: ImportPlan['sources'], skipped: ImportPlan['skipped']): ImportPlan {
  const uniq = <T>(xs: T[], key: (x: T) => string) => { const seen = new Map<string, T>(); for (const x of xs) { const k = key(x); if (k && !seen.has(k)) seen.set(k, x); } return [...seen.values()]; };
  const all = { loads: parts.flatMap((p) => p.loads), carriers: parts.flatMap((p) => p.carriers), trucks: parts.flatMap((p) => p.trucks), dispatchers: parts.flatMap((p) => p.dispatchers), brokers: parts.flatMap((p) => p.brokers) };
  // Names used on load rows become carriers / dispatchers too.
  for (const l of all.loads) {
    if (l.carrier) all.carriers.push({ name: l.carrier, mc: '', dot: '', phone: '', email: '', feePercent: 0, factoring: '' });
    if (l.dispatcher) all.dispatchers.push({ name: l.dispatcher, percent: 0 });
    if (l.truck && !all.trucks.some((t) => lc(t.unit) === lc(l.truck))) all.trucks.push({ unit: l.truck, driver: '', phone: '', carrier: l.carrier });
    if (l.broker) all.brokers.push({ name: l.broker, mc: l.brokerMc, email: '' });
  }
  const carriers = uniq(all.carriers.sort((a, b) => Number(!!b.mc) - Number(!!a.mc)), (c) => c.mc || lc(c.name)).filter((c, _, xs) => !c.mc ? !xs.some((o) => o !== c && o.mc && lc(o.name) === lc(c.name)) : true)
    .map((c) => ({ ...c, existing: state.carriers.some((x) => (c.mc && x.mc === c.mc) || lc(x.name) === lc(c.name)) }));
  const trucks = uniq(all.trucks.sort((a, b) => Number(!!b.driver) - Number(!!a.driver)), (t) => lc(t.unit) || lc(t.driver))
    .map((t) => ({ ...t, existing: state.trucks.some((x) => (t.unit && lc(x.unit) === lc(t.unit)) || (!t.unit && lc(x.driver) === lc(t.driver))) }));
  const dispatchers = uniq(all.dispatchers.sort((a, b) => b.percent - a.percent), (d) => lc(d.name)).map((d) => ({ ...d, existing: state.dispatchers.some((x) => lc(x.name) === lc(d.name)) }));
  const brokers = uniq(all.brokers.sort((a, b) => Number(!!b.email) - Number(!!a.email)), (b) => lc(b.name));
  const key = (l: { date: string; broker: string; pro: string; origin: string; destination: string; rate: number }) =>
    l.pro && l.broker ? `${lc(l.broker)}|${lc(l.pro)}` : `${l.date}|${lc(l.origin)}|${lc(l.destination)}|${l.rate}`;
  const onBoard = new Set(state.loads.map(key));
  const loads = uniq(all.loads, key).map((l) => ({ ...l, duplicate: onBoard.has(key(l)) }));
  return { id: randomUUID(), sources, skipped, dispatchers, carriers, trucks, loads, brokers };
}

/** Reads the files the person dropped and returns what would go on the board. */
export async function planImport(state: Parameters<typeof buildPlan>[0], files: ImportFile[]): Promise<ImportPlan> {
  const sources: ImportPlan['sources'] = [];
  const skipped: ImportPlan['skipped'] = [];
  const parts: ReturnType<typeof rowsToRecords>[] = [];
  await Promise.all(files.map(async (f) => {
    const kind = fileKind(f.name, f.data);
    try {
      if (kind === 'xlsx' || kind === 'csv') {
        const tables = kind === 'xlsx' ? readXlsx(f.data) : [{ source: '', rows: readCsv(f.data.toString('utf8').replace(/^﻿/, '')) }];
        if (!tables.length) { skipped.push({ name: f.name, reason: 'empty' }); return; }
        for (const t of tables) {
          const name = t.source ? `${f.name} · ${t.source}` : f.name;
          const map = await mapTable(t, f.name);
          if (map.kind === 'ignore') { skipped.push({ name, reason: map.what || 'nothing to import' }); continue; }
          const recs = rowsToRecords(t, map, name);
          const n = recs.loads.length + recs.carriers.length + recs.trucks.length + recs.dispatchers.length + recs.brokers.length;
          if (!n) { skipped.push({ name, reason: 'no rows could be read' }); continue; }
          parts.push(recs);
          sources.push({ name, what: map.what, rows: n });
        }
      } else if (kind === 'pdf' || kind === 'image') {
        const d = await readDoc(f, kind);
        const recs = docToRecords(d, f.name);
        const n = recs.loads.length + recs.carriers.length + recs.trucks.length + recs.dispatchers.length + recs.brokers.length;
        if (!n) { skipped.push({ name: f.name, reason: d.what || 'nothing to import' }); return; }
        parts.push(recs);
        sources.push({ name: f.name, what: d.what, rows: n });
      } else {
        skipped.push({ name: f.name, reason: 'not a spreadsheet, PDF or picture' });
      }
    } catch (e) {
      skipped.push({ name: f.name, reason: (e as Error).message });
    }
  }));
  return buildPlan(state, parts, sources, skipped);
}
