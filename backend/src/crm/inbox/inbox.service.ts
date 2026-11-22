import { Injectable, Logger } from '@nestjs/common';
import { config } from '../../config.js';
import { db } from '../../db.js';
import { sendMail } from '../../mail/mailer.js';
import { aiEnabled, readRateCon } from '../ai.js';
import { CrmStore } from '../crm.store.js';
import type { CrmUser, Load } from '../crm.types.js';
import { EldSyncService } from '../integrations/eld-sync.service.js';
import { PlacesService } from '../places.js';
import { InboxStore, type PostingRow } from './inbox.store.js';
import { fit, inquiry, postingKey, type TruckNow } from './match.js';
import { readEmail, type InboundEmail } from './read-email.js';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const validEmail = (e: string) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/.test(e);
const DAY = 86_400_000;

/**
 * Each board gets an address (loads-…@INBOUND_DOMAIN). Load-board alerts and brokers' load lists sent or forwarded
 * there become postings matched to the board's trucks; with autopilot on, brokers of good matches get an email at
 * once. Rate confirmations sent there become loads. Forwarding confirmations (Gmail) are shown so the owner can confirm.
 */
@Injectable()
export class InboxService {
  private readonly logger = new Logger(InboxService.name);
  private readonly places = new PlacesService();
  private made?: { inbox: InboxStore; board: CrmStore } | null;

  constructor(private readonly eld: EldSyncService) {}

  private get stores() {
    if (this.made === undefined) {
      const pool = db();
      if (!pool) this.made = null;
      else { const board = new CrmStore(pool); this.made = { board, inbox: new InboxStore(pool, board.ready) }; }
    }
    return this.made;
  }

  get store() { return this.stores?.inbox ?? null; }
  enabled() { return !!this.stores && !!config.inboundDomain; }
  address(token: string) { return `${token}@${config.inboundDomain}`; }

  /** An email from the webhook: every recipient that is a board's address gets it. */
  async receive(e: InboundEmail): Promise<number> {
    if (!this.stores) return 0;
    let n = 0;
    for (const to of e.to) {
      const [local, domain] = to.toLowerCase().replace(/^.*</, '').replace(/>.*$/, '').trim().split('@');
      if (!local || domain !== config.inboundDomain || !/^loads-[0-9a-f]{12}$/.test(local)) continue;
      const ws = await this.stores.inbox.boardOf(local);
      if (ws == null) continue;
      await this.process(ws, e).catch((err: Error) => this.logger.warn(`Inbox ws ${ws}: ${err.message}`));
      n++;
    }
    return n;
  }

  /** One email for one board. */
  async process(ws: number, e: InboundEmail): Promise<{ kind: string; postings: PostingRow[]; loadId?: number; note?: string }> {
    const { inbox, board } = this.stores!;
    const id = await inbox.addMessage(ws, e);
    if (!aiEnabled()) {
      await inbox.setMessage(id, { kind: 'other', summary: 'Received — AI is off, so it wasn’t read' });
      return { kind: 'other', postings: [] };
    }
    const today = new Date().toISOString().slice(0, 10);

    // A rate con in the attachments becomes a load (once per broker + load number).
    for (const a of e.attachments.slice(0, 3)) {
      if (!/pdf|jpe?g|png/i.test(a.contentType) || a.content.length > 10 * 1024 * 1024) continue;
      const mime = /pdf/i.test(a.contentType) ? 'application/pdf' : /png/i.test(a.contentType) ? 'image/png' : 'image/jpeg';
      const rc = await readRateCon(a.content, mime, today).catch(() => null);
      if (!rc?.isRateConfirmation) continue;
      const st = await board.state(ws, await this.ownerUser(ws));
      const same = rc.loadNumber && st.loads.find((l) => l.pro && l.pro.toLowerCase() === rc.loadNumber.toLowerCase() && l.broker.toLowerCase() === rc.broker.toLowerCase());
      if (same) {
        await inbox.setMessage(id, { kind: 'rate_confirmation', summary: `Rate con for load ${rc.loadNumber} — already on the board`, loadId: same.id });
        return { kind: 'rate_confirmation', postings: [], loadId: same.id };
      }
      const load = await board.addLoad(ws, {
        date: /^\d{4}-\d{2}-\d{2}$/.test(rc.pickupDate) ? rc.pickupDate : today, carrierId: null, dispatcherId: null, broker: rc.broker.slice(0, 200), pro: rc.loadNumber.slice(0, 60),
        origin: rc.origin.slice(0, 120), destination: rc.destination.slice(0, 120), rate: Math.max(0, rc.rate), notes: `From email: ${e.subject}`.slice(0, 120) + (rc.notes ? `\n${rc.notes}` : ''),
        status: 'booked', truckId: null, loadedMiles: Math.max(0, Math.round(rc.miles)), emptyMiles: 0, detention: 0, layover: 0, tonu: 0, other: 0, lumper: 0,
        invoicedOn: null, paidOn: null, brokerMc: rc.brokerMc.replace(/\D/g, '').slice(0, 10),
      } as Omit<Load, 'id'>);
      await board.addFile(ws, load.id, { kind: 'ratecon', name: a.filename.slice(0, 200) || 'ratecon.pdf', mime, data: a.content }).catch(() => undefined);
      await inbox.setMessage(id, { kind: 'rate_confirmation', summary: `Rate con → new load: ${rc.broker} ${rc.origin} → ${rc.destination}`, loadId: load.id });
      return { kind: 'rate_confirmation', postings: [], loadId: load.id };
    }

    const r = await readEmail(e, today);
    if (r.kind === 'forwarding_confirmation') {
      await inbox.setMessage(id, { kind: r.kind, summary: r.summary, note: r.confirmation });
      return { kind: r.kind, postings: [], note: r.confirmation };
    }
    if (r.kind !== 'load_postings' || !r.postings.length) {
      await inbox.setMessage(id, { kind: r.kind === 'load_postings' ? 'other' : r.kind, summary: r.summary });
      return { kind: r.kind, postings: [] };
    }
    const settings = await inbox.settings(ws);
    const trucks = await this.trucksNow(ws);
    const find = (p: string) => this.places.find(p);
    const fresh = await inbox.addPostings(ws, id, r.postings.slice(0, 60).map((p) => ({ key: postingKey(p), data: p, fit: fit(p, trucks, find, settings) })));
    await inbox.setMessage(id, { kind: 'load_postings', summary: r.summary, postings: r.postings.length, note: fresh.length < r.postings.length ? `${r.postings.length - fresh.length} seen before` : '' });
    if (settings.autoEmail) await this.autopilot(ws, fresh, settings.dailyCap);
    return { kind: 'load_postings', postings: fresh };
  }

  /** Autopilot: the broker of each good match gets the first email right away (within the daily cap, once per load). */
  private async autopilot(ws: number, fresh: PostingRow[], cap: number) {
    const { inbox } = this.stores!;
    let sent = await inbox.autoEmailedToday(ws);
    for (const p of fresh) {
      if (sent >= cap) break;
      if (!p.fit.ok || !validEmail(p.data.email)) continue;
      const owner = await inbox.owner(ws);
      if (!owner) return;
      const d = await this.draft(ws, p, owner.name);
      if (!(await inbox.markEmailed(ws, p.id, true))) continue;
      try {
        await this.send(ws, owner, p.data.email, d.subject, d.body);
        sent++;
      } catch (e) {
        await inbox.unmarkEmailed(ws, p.id);
        this.logger.warn(`Autopilot email ws ${ws}: ${(e as Error).message}`);
      }
    }
  }

  /** Trucks move: loads not emailed yet are matched again against where the trucks are now. */
  async refit(ws: number, rows: PostingRow[]): Promise<PostingRow[]> {
    if (!rows.some((p) => p.status === 'new')) return rows;
    const [trucks, settings] = await Promise.all([this.trucksNow(ws), this.stores!.inbox.settings(ws)]);
    const find = (x: string) => this.places.find(x);
    return rows.map((p) => (p.status === 'new' ? { ...p, fit: fit(p.data, trucks, find, settings) } : p));
  }

  async draft(ws: number, p: PostingRow, me: string) {
    const co = await this.stores!.board.company(ws);
    const [now] = await this.refit(ws, [p]);
    return inquiry(p.data, now.fit.best, { name: co.name, mc: co.mc, phone: co.phone }, me);
  }

  /** The dispatcher pressed Send (maybe after editing the email). */
  async emailPosting(ws: number, user: CrmUser, id: number, subject: string, body: string) {
    const { inbox } = this.stores!;
    const p = await inbox.posting(ws, id);
    if (!p) throw new Error('This load is gone');
    if (!validEmail(p.data.email)) throw new Error('This posting has no email — call the broker');
    if (!(await inbox.markEmailed(ws, id, false))) throw new Error('The broker was already emailed about this load');
    try {
      await this.send(ws, { name: user.name, email: user.email }, p.data.email, subject, body);
    } catch (e) {
      await inbox.unmarkEmailed(ws, id);
      throw e;
    }
    return { to: p.data.email };
  }

  private async send(ws: number, from: { name: string; email: string }, to: string, subject: string, body: string) {
    const co = await this.stores!.board.company(ws);
    await sendMail({
      to, fromName: `${co.name || from.name} via HaulPanel`, replyTo: from.email, subject: subject.slice(0, 200),
      text: body, html: `<div style="font:14px/1.5 sans-serif">${esc(body).replace(/\n/g, '<br>')}</div>`,
    });
  }

  /** The board's trucks now: where each is (ELD or Telegram, newest), whether it's on a load, and hours left. */
  async trucksNow(ws: number): Promise<TruckNow[]> {
    const st = await this.stores!.board.state(ws, await this.ownerUser(ws));
    const eld = (await this.eld.store?.units(ws).catch(() => [])) ?? [];
    return st.trucks.map((t) => {
      const e = eld.find((u) => u.truckId === t.id);
      const p = st.positions.find((x) => x.truckId === t.id);
      const useEld = !!e?.at && e.lat != null && (!p || e.at >= p.at);
      const at = useEld ? { lat: e!.lat!, lon: e!.lon! } : p ? { lat: p.lat, lon: p.lon } : null;
      const load = st.loads.find((l) => l.truckId === t.id && (l.status === 'in_transit' || l.status === 'booked'));
      const dest = load ? this.places.find(load.destination) : null;
      const days = load ? Math.max(1, Math.ceil((load.loadedMiles || 500) / 500)) : 0;
      return {
        id: t.id, unit: t.unit, driver: e?.driver || t.driver, at, where: useEld ? e!.address : '',
        busyUntil: load && dest ? { place: dest, name: load.destination, date: new Date(new Date(`${load.date}T12:00:00Z`).getTime() + days * DAY).toISOString().slice(0, 10) } : null,
        driveLeftMin: e?.hos?.driveLeftMin ?? null,
      };
    });
  }

  private async ownerUser(ws: number): Promise<CrmUser> {
    const o = await this.stores!.inbox.owner(ws);
    return { id: 0, email: o?.email ?? '', name: o?.name ?? '', picture: '' };
  }
}
