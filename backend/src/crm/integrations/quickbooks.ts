import { randomBytes } from 'node:crypto';

// QuickBooks Online: the owner connects their company (OAuth 2.0), every invoice HaulPanel sends is also created in
// QuickBooks (customer = the broker, item = "Freight"), and invoices paid in QuickBooks mark the load paid.
// Endpoints and rules from developer.intuit.com (checked 2026-11-21): tokens last 1 h, refresh tokens rotate and must
// be refreshed one at a time; writes are free, reads are metered (500k/month free), so payment checks are batched.

export const QBO_SCOPE = 'com.intuit.quickbooks.accounting';
const AUTHORIZE = 'https://appcenter.intuit.com/connect/oauth2';
const TOKEN = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const REVOKE = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';
const API = { sandbox: 'https://sandbox-quickbooks.api.intuit.com', production: 'https://quickbooks.api.intuit.com' };
const MINOR = 75;

export interface QboApp { clientId: string; clientSecret: string; sandbox: boolean; redirectUri: string }
/** What is stored (sealed) for a connected company. */
export interface QboTokens { realmId: string; refresh: string; access: string; accessExpires: number; itemId?: string }

export class QboError extends Error {
  constructor(message: string, readonly auth = false, readonly code = '') { super(message); }
}

type Fetch = typeof fetch;
type Json = Record<string, unknown>;

export function authorizeUrl(app: QboApp, state: string) {
  const q = new URLSearchParams({ client_id: app.clientId, response_type: 'code', scope: QBO_SCOPE, redirect_uri: app.redirectUri, state });
  return `${AUTHORIZE}?${q}`;
}

export const newState = () => randomBytes(18).toString('base64url');

async function token(app: QboApp, body: Record<string, string>, fetcher: Fetch): Promise<{ refresh: string; access: string; accessExpires: number }> {
  const res = await fetcher(TOKEN, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${Buffer.from(`${app.clientId}:${app.clientSecret}`).toString('base64')}` },
    body: new URLSearchParams(body).toString(), signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  if (!res) throw new QboError('QuickBooks isn’t answering right now');
  const j = (await res.json().catch(() => ({}))) as Json;
  if (!res.ok || !j.access_token) throw new QboError(j.error === 'invalid_grant' ? 'QuickBooks ended the connection — connect it again' : `QuickBooks sign-in failed (${String(j.error ?? res.status)})`, j.error === 'invalid_grant');
  return { refresh: String(j.refresh_token), access: String(j.access_token), accessExpires: Date.now() + (Number(j.expires_in) || 3600) * 1000 - 60_000 };
}

export const exchangeCode = (app: QboApp, code: string, fetcher: Fetch = fetch) =>
  token(app, { grant_type: 'authorization_code', code, redirect_uri: app.redirectUri }, fetcher);

export async function revoke(app: QboApp, refresh: string, fetcher: Fetch = fetch) {
  await fetcher(REVOKE, {
    method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Basic ${Buffer.from(`${app.clientId}:${app.clientSecret}`).toString('base64')}` },
    body: JSON.stringify({ token: refresh }), signal: AbortSignal.timeout(15_000),
  }).catch(() => undefined);
}

/** `'` → `\'` for the QuickBooks query language; names lose characters it can't take. */
const q = (s: string) => s.replace(/\\/g, '').replace(/'/g, "\\'");
const cleanName = (s: string) => s.replace(/[:\t\n\r]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);

/** One connected company. `save` is called with new tokens whenever they change (they rotate). */
export class QboClient {
  constructor(private readonly app: QboApp, private t: QboTokens, private readonly save: (t: QboTokens) => Promise<void>, private readonly fetcher: Fetch = fetch) {}

  get tokens() { return this.t; }

  private async access() {
    if (Date.now() < this.t.accessExpires) return this.t.access;
    const n = await token(this.app, { grant_type: 'refresh_token', refresh_token: this.t.refresh }, this.fetcher);
    this.t = { ...this.t, ...n };
    await this.save(this.t);
    return this.t.access;
  }

  private async call(method: 'GET' | 'POST', path: string, body?: unknown, retry = true): Promise<Json> {
    const base = this.app.sandbox ? API.sandbox : API.production;
    const sep = path.includes('?') ? '&' : '?';
    const res = await this.fetcher(`${base}/v3/company/${this.t.realmId}/${path}${sep}minorversion=${MINOR}`, {
      method, headers: { Accept: 'application/json', Authorization: `Bearer ${await this.access()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000),
    }).catch(() => null);
    if (!res) throw new QboError('QuickBooks isn’t answering right now');
    if (res.status === 401 && retry) { this.t = { ...this.t, accessExpires: 0 }; return this.call(method, path, body, false); }
    const j = (await res.json().catch(() => ({}))) as Json;
    if (res.status === 401 || res.status === 403) throw new QboError('QuickBooks didn’t allow this — connect it again', true);
    if (!res.ok) {
      const err = ((j.Fault as Json | undefined)?.Error as Json[] | undefined)?.[0] ?? {};
      throw new QboError(`QuickBooks: ${String(err.Detail ?? err.Message ?? `error ${res.status}`)}`, false, String(err.code ?? ''));
    }
    return j;
  }

  async query<T = Json>(entity: string, where: string): Promise<T[]> {
    const r = await this.call('GET', `query?query=${encodeURIComponent(`select * from ${entity} where ${where}`)}`);
    return (((r.QueryResponse as Json | undefined)?.[entity]) as T[] | undefined) ?? [];
  }

  async companyName(): Promise<string> {
    const r = await this.call('GET', `companyinfo/${this.t.realmId}`);
    return String((r.CompanyInfo as Json | undefined)?.CompanyName ?? '');
  }

  /** The broker as a QuickBooks customer: found by name, or created (with its MC if the name is taken by a vendor). */
  async customer(name: string, mc: string, email: string): Promise<string> {
    const n = cleanName(name) || 'Broker';
    const found = await this.query<Json>('Customer', `DisplayName = '${q(n)}' and Active IN (true,false)`);
    if (found[0]) return String(found[0].Id);
    const make = (displayName: string) => this.call('POST', 'customer', {
      DisplayName: displayName, CompanyName: n, ...(email ? { PrimaryEmailAddr: { Address: email } } : {}), Notes: `Broker${mc ? ` MC ${mc}` : ''} · added by HaulPanel`,
    });
    try {
      return String(((await make(n)).Customer as Json).Id);
    } catch (e) {
      if (!(e instanceof QboError) || e.code !== '6240') throw e;
      const alt = cleanName(`${n} (${mc ? `MC ${mc}` : 'broker'})`);
      const again = await this.query<Json>('Customer', `DisplayName = '${q(alt)}' and Active IN (true,false)`);
      return again[0] ? String(again[0].Id) : String(((await make(alt)).Customer as Json).Id);
    }
  }

  /** The "Freight" service item every invoice line uses (made once, under an income account). */
  async freightItem(): Promise<string> {
    if (this.t.itemId) return this.t.itemId;
    const found = await this.query<Json>('Item', `Name = 'Freight'`);
    let id = found[0] ? String(found[0].Id) : '';
    if (!id) {
      const accounts = await this.query<Json>('Account', `AccountType = 'Income' and Active = true`);
      const acc = accounts.find((a) => a.AccountSubType === 'ServiceFeeIncome') ?? accounts.find((a) => /freight|service|sales/i.test(String(a.Name))) ?? accounts[0];
      if (!acc) throw new QboError('QuickBooks has no income account to put freight income in — add one in QuickBooks first');
      id = String(((await this.call('POST', 'item', { Name: 'Freight', Type: 'Service', Description: 'Freight / linehaul (HaulPanel)', IncomeAccountRef: { value: String(acc.Id) } })).Item as Json).Id);
    }
    this.t = { ...this.t, itemId: id };
    await this.save(this.t);
    return id;
  }

  /** Creates the invoice (once: the same load and number never make a second one). Returns its QuickBooks id. */
  async createInvoice(inv: QboInvoice): Promise<string> {
    const existing = await this.query<Json>('Invoice', `DocNumber = '${q(inv.docNumber)}'`);
    if (existing[0]) return String(existing[0].Id);
    const [customerId, itemId] = await Promise.all([this.customer(inv.broker, inv.brokerMc, inv.billEmail), this.freightItem()]);
    const r = await this.call('POST', `invoice?requestid=${encodeURIComponent(inv.requestId.slice(0, 50))}`, {
      CustomerRef: { value: customerId }, DocNumber: inv.docNumber.slice(0, 21), TxnDate: inv.date, DueDate: inv.due,
      ...(inv.billEmail ? { BillEmail: { Address: inv.billEmail } } : {}),
      CustomerMemo: { value: inv.memo.slice(0, 1000) }, PrivateNote: inv.note.slice(0, 4000),
      Line: inv.lines.map((l) => ({ DetailType: 'SalesItemLineDetail', Amount: l.amount, Description: l.label.slice(0, 4000), SalesItemLineDetail: { ItemRef: { value: itemId }, Qty: 1, UnitPrice: l.amount, ...(l.date ? { ServiceDate: l.date } : {}) } })),
    });
    return String((r.Invoice as Json).Id);
  }

  /** Which of these invoices are fully paid (balance 0). */
  async paid(ids: string[]): Promise<string[]> {
    const out: string[] = [];
    for (let i = 0; i < ids.length; i += 500) {
      const rows = await this.query<Json>('Invoice', `Id IN (${ids.slice(i, i + 500).map((x) => `'${q(x)}'`).join(',')})`);
      out.push(...rows.filter((r) => Number(r.Balance) === 0 && Number(r.TotalAmt) > 0).map((r) => String(r.Id)));
    }
    return out;
  }
}

export interface QboInvoice {
  docNumber: string; requestId: string; date: string; due: string; broker: string; brokerMc: string; billEmail: string;
  memo: string; note: string; lines: { label: string; amount: number; date?: string }[];
}
