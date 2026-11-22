import { describe, expect, it } from 'vitest';
import { authorizeUrl, exchangeCode, QboClient, type QboApp, type QboTokens } from './quickbooks.js';

const app: QboApp = { clientId: 'cid', clientSecret: 'sec', sandbox: true, redirectUri: 'https://haulpanel.com/api/crm/integrations/quickbooks/callback' };

type Call = { url: string; method: string; body: string; auth: string };
/** A fake Intuit: answers by matching the URL (and the query text for queries). */
function intuit(handler: (c: Call) => { status?: number; json: unknown }) {
  const calls: Call[] = [];
  const fetcher = (async (url: string, init: { method?: string; body?: string; headers: Record<string, string> }) => {
    const c = { url: decodeURIComponent(url), method: init.method ?? 'GET', body: init.body ?? '', auth: init.headers.Authorization };
    calls.push(c);
    const r = handler(c);
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { calls, fetcher };
}

describe('QuickBooks connection', () => {
  it('sends the owner to Intuit with our app, scope, callback and state', () => {
    const u = new URL(authorizeUrl(app, 'st123'));
    expect(u.origin + u.pathname).toBe('https://appcenter.intuit.com/connect/oauth2');
    expect(Object.fromEntries(u.searchParams)).toEqual({ client_id: 'cid', response_type: 'code', scope: 'com.intuit.quickbooks.accounting', redirect_uri: app.redirectUri, state: 'st123' });
  });

  it('turns the code into tokens with Basic auth', async () => {
    const { calls, fetcher } = intuit(() => ({ json: { access_token: 'A1', refresh_token: 'R1', expires_in: 3600 } }));
    const t = await exchangeCode(app, 'code1', fetcher);
    expect(t).toMatchObject({ access: 'A1', refresh: 'R1' });
    expect(calls[0].auth).toBe(`Basic ${Buffer.from('cid:sec').toString('base64')}`);
    expect(calls[0].body).toContain('grant_type=authorization_code');
    expect(calls[0].body).toContain('code=code1');
  });
});

describe('QuickBooks invoices', () => {
  it('refreshes an expired token first and saves the rotated one, then creates broker, Freight item and invoice once', async () => {
    const saved: QboTokens[] = [];
    const { calls, fetcher } = intuit((c) => {
      if (c.url.includes('/tokens/bearer')) return { json: { access_token: 'A2', refresh_token: 'R2', expires_in: 3600 } };
      if (c.url.includes("from Invoice where DocNumber = 'INV-00007'")) return { json: { QueryResponse: {} } };
      if (c.url.includes("from Customer where DisplayName = 'Total Quality Logistics'")) return { json: { QueryResponse: {} } };
      if (c.url.includes('/customer?') && c.method === 'POST') return { json: { Customer: { Id: '67' } } };
      if (c.url.includes("from Item where Name = 'Freight'")) return { json: { QueryResponse: {} } };
      if (c.url.includes('from Account where')) return { json: { QueryResponse: { Account: [{ Id: '5', Name: 'Sales', AccountSubType: 'SalesOfProductIncome' }, { Id: '79', Name: 'Freight Income', AccountSubType: 'ServiceFeeIncome' }] } } };
      if (c.url.includes('/item?') && c.method === 'POST') return { json: { Item: { Id: '21' } } };
      if (c.url.includes('/invoice?') && c.method === 'POST') return { json: { Invoice: { Id: '130' } } };
      return { status: 404, json: {} };
    });
    const client = new QboClient(app, { realmId: '9130', refresh: 'R1', access: 'old', accessExpires: 0 }, async (t) => { saved.push(t); }, fetcher);
    const id = await client.createInvoice({
      docNumber: 'INV-00007', requestId: 'hp-1-7-INV-00007', date: '2026-11-21', due: '2026-12-21', broker: 'Total Quality Logistics', brokerMc: '411443', billEmail: 'ap@tql.example',
      memo: 'Load T-77', note: 'HaulPanel load 7', lines: [{ label: 'Linehaul', amount: 2400, date: '2026-11-10' }, { label: 'Detention', amount: 100 }],
    });
    expect(id).toBe('130');
    expect(saved[0]).toMatchObject({ refresh: 'R2', access: 'A2' });
    expect(saved.at(-1)).toMatchObject({ itemId: '21' });
    const api = calls.filter((c) => c.url.startsWith('https://sandbox-quickbooks.api.intuit.com/v3/company/9130/'));
    expect(api.every((c) => c.auth === 'Bearer A2' && c.url.includes('minorversion=75'))).toBe(true);
    const item = JSON.parse(calls.find((c) => c.url.includes('/item?'))!.body);
    expect(item).toMatchObject({ Name: 'Freight', Type: 'Service', IncomeAccountRef: { value: '79' } });
    const inv = calls.find((c) => c.url.includes('/invoice?'))!;
    expect(inv.url).toContain('requestid=hp-1-7-INV-00007');
    expect(JSON.parse(inv.body)).toMatchObject({
      CustomerRef: { value: '67' }, DocNumber: 'INV-00007', TxnDate: '2026-11-21', DueDate: '2026-12-21', BillEmail: { Address: 'ap@tql.example' },
      Line: [{ Amount: 2400, SalesItemLineDetail: { ItemRef: { value: '21' }, ServiceDate: '2026-11-10' } }, { Amount: 100 }],
    });
  });

  it('does not make a second invoice for the same number', async () => {
    const { calls, fetcher } = intuit((c) => (c.url.includes('from Invoice') ? { json: { QueryResponse: { Invoice: [{ Id: '130' }] } } } : { status: 500, json: {} }));
    const client = new QboClient(app, { realmId: '1', refresh: 'R', access: 'A', accessExpires: Date.now() + 3600_000 }, async () => undefined, fetcher);
    expect(await client.createInvoice({ docNumber: 'INV-1', requestId: 'r', date: '2026-11-21', due: '2026-12-21', broker: 'X', brokerMc: '', billEmail: '', memo: '', note: '', lines: [{ label: 'L', amount: 1 }] })).toBe('130');
    expect(calls).toHaveLength(1);
  });

  it('a broker whose name is taken by a vendor is created with its MC', async () => {
    let tries = 0;
    const { calls, fetcher } = intuit((c) => {
      if (c.url.includes('from Customer')) return { json: { QueryResponse: {} } };
      if (c.url.includes('/customer?')) return ++tries === 1
        ? { status: 400, json: { Fault: { Error: [{ Message: 'Duplicate Name Exists Error', code: '6240' }] } } }
        : { json: { Customer: { Id: '88' } } };
      return { status: 404, json: {} };
    });
    const client = new QboClient(app, { realmId: '1', refresh: 'R', access: 'A', accessExpires: Date.now() + 3600_000 }, async () => undefined, fetcher);
    expect(await client.customer("Bob's: Freight", '123456', '')).toBe('88');
    expect(calls[0].url).toContain("DisplayName = 'Bob\\'s Freight'");
    expect(JSON.parse(calls.at(-1)!.body).DisplayName).toBe("Bob's Freight (MC 123456)");
  });

  it('reports only fully paid invoices', async () => {
    const { calls, fetcher } = intuit(() => ({ json: { QueryResponse: { Invoice: [{ Id: '1', Balance: 0, TotalAmt: 2000 }, { Id: '2', Balance: 500, TotalAmt: 2000 }] } } }));
    const client = new QboClient(app, { realmId: '1', refresh: 'R', access: 'A', accessExpires: Date.now() + 3600_000 }, async () => undefined, fetcher);
    expect(await client.paid(['1', '2'])).toEqual(['1']);
    expect(calls[0].url).toContain("Id IN ('1','2')");
  });

  it('a revoked connection says to connect again', async () => {
    const { fetcher } = intuit(() => ({ status: 400, json: { error: 'invalid_grant' } }));
    const client = new QboClient(app, { realmId: '1', refresh: 'R', access: 'A', accessExpires: 0 }, async () => undefined, fetcher);
    await expect(client.paid(['1'])).rejects.toMatchObject({ auth: true, message: expect.stringContaining('connect it again') });
  });
});
