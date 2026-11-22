import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { config } from '../../config.js';
import { db } from '../../db.js';
import { CrmStore } from '../crm.store.js';
import type { CrmUser } from '../crm.types.js';
import { invoiceParts } from '../invoice-send.js';
import { EldSyncService } from './eld-sync.service.js';
import { exchangeCode, newState, QboClient, QboError, revoke, authorizeUrl, type QboApp, type QboTokens } from './quickbooks.js';
import { vaultReady } from './vault.js';

const PROVIDER = 'quickbooks';

/**
 * QuickBooks Online for a board: connect (OAuth), push each sent invoice, and every few hours mark loads paid when
 * QuickBooks says their invoice is paid. All calls for one board run one after another, because QuickBooks refresh
 * tokens rotate and two refreshes at once would end the connection.
 */
@Injectable()
export class QboService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(QboService.name);
  private readonly states = new Map<string, { ws: number; userId: number; expires: number }>();
  private readonly queue = new Map<number, Promise<unknown>>();
  private crm?: CrmStore;
  private timer?: NodeJS.Timeout;

  constructor(private readonly eld: EldSyncService) {}

  get app(): QboApp | null {
    if (!config.qboClientId || !config.qboClientSecret || !config.publicUrl) return null;
    return { clientId: config.qboClientId, clientSecret: config.qboClientSecret, sandbox: config.qboSandbox, redirectUri: `${config.publicUrl}/api/crm/integrations/quickbooks/callback` };
  }

  enabled() {
    return !!this.app && !!this.eld.store && vaultReady();
  }

  private get store() { return this.eld.store!; }
  private get board() { return (this.crm ??= new CrmStore(db()!)); }

  onApplicationBootstrap() {
    if (!this.enabled()) return;
    this.timer = setInterval(() => void this.syncPaymentsAll(), 4 * 3600_000);
    this.timer.unref();
    setTimeout(() => void this.syncPaymentsAll(), 3 * 60_000).unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  /** Runs `fn` after everything already queued for this board. */
  private serial<T>(ws: number, fn: () => Promise<T>): Promise<T> {
    const run = (this.queue.get(ws) ?? Promise.resolve()).catch(() => undefined).then(fn);
    this.queue.set(ws, run);
    return run.finally(() => { if (this.queue.get(ws) === run) this.queue.delete(ws); });
  }

  /** Where to send the owner to approve the connection in QuickBooks. */
  start(ws: number, userId: number): string {
    const app = this.app!;
    const now = Date.now();
    for (const [k, v] of this.states) if (v.expires < now) this.states.delete(k);
    const state = newState();
    this.states.set(state, { ws, userId, expires: now + 15 * 60_000 });
    return authorizeUrl(app, state);
  }

  /** QuickBooks sent the owner back: the code becomes tokens, stored sealed. Returns the company name. */
  async finish(state: string, code: string, realmId: string, userId: number): Promise<{ ws: number; company: string }> {
    const s = this.states.get(state);
    this.states.delete(state);
    if (!s || s.expires < Date.now() || s.userId !== userId) throw new QboError('This QuickBooks link has expired — press Connect again');
    if (!/^\d{1,30}$/.test(realmId)) throw new QboError('QuickBooks didn’t say which company was connected');
    const t = await exchangeCode(this.app!, code);
    const tokens: QboTokens = { realmId, ...t };
    let company = '';
    const client = new QboClient(this.app!, tokens, async (n) => { tokens.refresh = n.refresh; tokens.access = n.access; tokens.accessExpires = n.accessExpires; });
    company = await client.companyName().catch(() => '');
    await this.store.connect(s.ws, PROVIDER, 'us', JSON.stringify(client.tokens), company);
    return { ws: s.ws, company };
  }

  async disconnect(ws: number) {
    await this.serial(ws, async () => {
      const raw = await this.store.secretOf(ws, PROVIDER);
      if (raw && this.app) await revoke(this.app, (JSON.parse(raw) as QboTokens).refresh);
      await this.store.disconnect(ws, PROVIDER);
    });
  }

  private async client(ws: number): Promise<QboClient | null> {
    if (!this.enabled()) return null;
    const raw = await this.store.secretOf(ws, PROVIDER);
    if (!raw) return null;
    return new QboClient(this.app!, JSON.parse(raw) as QboTokens, (t) => this.store.setSecret(ws, PROVIDER, JSON.stringify(t)));
  }

  /** After an invoice is sent from HaulPanel: the same invoice in QuickBooks. Never throws (the email already went). */
  push(ws: number, user: CrmUser, loadId: number): Promise<void> {
    return this.serial(ws, async () => {
      const c = await this.client(ws);
      if (!c) return;
      try {
        const { load, data } = await invoiceParts(this.board, ws, user, loadId, []);
        const lane = `${data.load.origin || '—'} → ${data.load.destination || '—'}`;
        const id = await c.createInvoice({
          docNumber: data.number, requestId: `hp-${ws}-${loadId}-${data.number}`, date: data.date, due: data.due,
          broker: data.billTo.name || 'Broker', brokerMc: data.billTo.mc ?? '', billEmail: data.billTo.email ?? '',
          memo: `Load ${load.pro || load.id} · ${lane} · pickup ${data.load.pickupDate}${data.remitTo ? ` · Remit to ${data.remitTo}` : ''}`,
          note: `HaulPanel load ${load.id}${load.pro ? ` (load # ${load.pro})` : ''} · carrier ${data.from.name}${data.from.mc ? ` MC ${data.from.mc}` : ''}`,
          lines: data.lines.map((l, i) => ({ label: i === 0 ? `${l.label} · Load ${load.pro || load.id} · ${lane}` : l.label, amount: l.amount, date: i === 0 ? data.load.pickupDate : undefined })),
        });
        await this.store.qboPushed(ws, loadId, id, data.number);
        await this.store.markOk(ws, PROVIDER);
      } catch (e) {
        this.logger.warn(`QuickBooks push ws ${ws} load ${loadId}: ${(e as Error).message}`);
        if (e instanceof QboError) await this.store.markError(ws, PROVIDER, e.auth ? e.message : `Last invoice didn’t reach QuickBooks: ${e.message}`);
      }
    });
  }

  /** Every invoice already sent from HaulPanel that isn't in QuickBooks yet (right after connecting). */
  async pushExisting(ws: number, user: CrmUser): Promise<number> {
    const st = await this.board.state(ws, user);
    const done = new Set(await this.store.qboLoads(ws));
    const todo = st.invoices.filter((i) => !done.has(i.loadId)).map((i) => i.loadId).slice(0, 200);
    for (const id of todo) await this.push(ws, user, id);
    return todo.length;
  }

  /** Loads whose QuickBooks invoice is paid become paid on the board (today's date). */
  async syncPayments(ws: number): Promise<number> {
    return this.serial(ws, async () => {
      const c = await this.client(ws);
      if (!c) return 0;
      const open = await this.store.qboOpen(ws);
      if (!open.length) return 0;
      try {
        const paid = new Set(await c.paid(open.map((o) => o.qboId)));
        const loads = open.filter((o) => paid.has(o.qboId)).map((o) => o.loadId);
        const today = new Date().toISOString().slice(0, 10);
        for (const id of loads) {
          const l = await this.board.loadById(ws, id);
          if (!l || l.status === 'paid') continue;
          const { id: _id, ...rest } = l;
          await this.board.updateLoad(ws, id, { ...rest, status: 'paid', paidOn: today, invoicedOn: l.invoicedOn ?? today });
        }
        if (loads.length) await this.store.qboPaid(ws, loads);
        await this.store.markOk(ws, PROVIDER);
        return loads.length;
      } catch (e) {
        if (e instanceof QboError && e.auth) await this.store.markError(ws, PROVIDER, e.message);
        throw e;
      }
    });
  }

  private async syncPaymentsAll() {
    try {
      for (const c of await this.store.allOf([PROVIDER])) {
        await this.syncPayments(c.ws).catch((e: Error) => this.logger.warn(`QuickBooks payments ws ${c.ws}: ${e.message}`));
      }
    } catch (e) {
      this.logger.warn(`QuickBooks payments: ${(e as Error).message}`);
    }
  }
}
