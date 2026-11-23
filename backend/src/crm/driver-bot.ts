import { Logger } from '@nestjs/common';
import { db } from '../db.js';
import { CrmStore, type DriverInfo, type FileKind } from './crm.store.js';
import type { Load } from './crm.types.js';
import { classifyDoc } from './ai.js';

// Drivers use the same Telegram bot as the leads: a dispatcher sends the truck's link (t.me/<bot>?start=drv_<token>),
// the driver taps it once, and then reports with buttons — loaded, delivered — sends BOL / POD photos (saved to
// the load) and shares their location (the truck shows on the board map and the broker's tracking page).

export interface DriverMessage {
  message_id: number;
  chat: { id: number; type: string };
  from?: { id: number; first_name?: string; last_name?: string; is_bot?: boolean };
  text?: string;
  caption?: string;
  photo?: { file_id: string; file_size?: number }[];
  document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
  location?: { latitude: number; longitude: number; live_period?: number };
}

interface BotApi {
  call(method: string, body: unknown): Promise<unknown>;
  /** Downloads a file the user sent (Telegram's getFile + file URL). */
  download(fileId: string): Promise<Buffer>;
}

const BTN_LOADED = '🚚 Loaded';
const BTN_DELIVERED = '✅ Delivered';
const BTN_LOAD = 'ℹ️ My load';
const BTN_LOCATION = '📍 Send my location';
const MAX_FILE = 10 * 1024 * 1024;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** "BOL" / "POD" in the caption decides; otherwise a photo before delivery is the BOL, after it the POD. */
export function docKind(caption: string, load: Pick<Load, 'status'> | null): FileKind {
  if (/\bbol\b|lading/i.test(caption)) return 'bol';
  if (/\bpod\b|proof|deliver/i.test(caption)) return 'pod';
  if (/rate|\brc\b|confirm/i.test(caption)) return 'ratecon';
  if (/lumper|receipt|scale|fuel/i.test(caption)) return 'other';
  return load?.status === 'delivered' ? 'pod' : 'bol';
}

export class DriverBot {
  private readonly logger = new Logger(DriverBot.name);
  private store: CrmStore | null = null;

  constructor(private readonly api: BotApi) {}

  private db(): CrmStore | null {
    const pool = db();
    if (!pool) return null;
    return (this.store ??= new CrmStore(pool));
  }

  private keyboard() {
    return {
      keyboard: [[{ text: BTN_LOADED }, { text: BTN_DELIVERED }], [{ text: BTN_LOCATION, request_location: true }], [{ text: BTN_LOAD }]],
      resize_keyboard: true, is_persistent: true,
    };
  }

  private send(chatId: number, text: string, keyboard = true) {
    return this.api.call('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...(keyboard ? { reply_markup: this.keyboard() } : {}) });
  }

  private lane(l: Load) {
    return `${esc(l.origin || '—')} → ${esc(l.destination || '—')}${l.pro ? ` (#${esc(l.pro)})` : ''}`;
  }

  /** Handles the message when it is a driver's; false lets the rest of the bot handle it. */
  async handle(m: DriverMessage, edited: boolean): Promise<boolean> {
    if (m.chat.type !== 'private' || !m.from || m.from.is_bot) return false;
    const store = this.db();
    if (!store) return false;
    const text = (m.text ?? '').trim();

    const start = /^\/start\s+drv_([A-Za-z0-9_-]{8,40})$/.exec(text);
    if (start) {
      const name = [m.from.first_name, m.from.last_name].filter(Boolean).join(' ').slice(0, 80);
      const d = await store.connectDriver(start[1], m.from.id, m.chat.id, name);
      if (!d) { await this.send(m.chat.id, 'This driver link has expired — ask your dispatcher for a new one.', false); return true; }
      await this.send(m.chat.id, [
        `✅ <b>Connected to ${esc(d.company || 'your dispatcher')}</b>${d.unit ? ` as truck #${esc(d.unit)}` : ''}.`,
        '',
        'Use the buttons below:',
        `${BTN_LOADED} — when you are loaded at the shipper`,
        `${BTN_DELIVERED} — when you have delivered`,
        '📄 Send photos of the BOL and POD here — they go straight to the load',
        `${BTN_LOCATION} — or better, share your <b>live location</b>: 📎 → Location → Share My Live Location (8 hours)`,
      ].join('\n'));
      await this.tellLoad(store, d, m.chat.id);
      return true;
    }

    const d = await store.driver(m.from.id);
    if (!d) return false;

    if (m.location) {
      const live = m.location.live_period ? Math.min(m.location.live_period, 24 * 3600) : null;
      await store.savePosition(d.ws, d.truckId, m.location.latitude, m.location.longitude, edited ? null : live);
      if (!edited) await this.send(m.chat.id, live ? '📍 Thanks — your dispatcher sees the truck live on the map.' : '📍 Location sent to your dispatcher. Tip: share your live location so you don’t have to send it again.');
      return true;
    }
    if (edited) return true;

    if (m.photo?.length || m.document) {
      await this.saveDocument(store, d, m);
      return true;
    }

    if (text === BTN_LOADED || text === BTN_DELIVERED) {
      const load = await store.currentLoad(d.ws, d.truckId);
      if (!load) { await this.send(m.chat.id, 'No load is assigned to your truck yet — your dispatcher will add it.'); return true; }
      const status = text === BTN_LOADED ? 'in_transit' : 'delivered';
      await store.setLoadStatus(d.ws, load.id, status);
      await this.send(m.chat.id, status === 'in_transit'
        ? `🚚 Marked <b>loaded / in transit</b>: ${this.lane(load)}.\nSend a photo of the BOL here.`
        : `✅ Marked <b>delivered</b>: ${this.lane(load)}.\nSend a photo of the signed POD here — the invoice goes out with it.`);
      return true;
    }
    if (text === BTN_LOAD || text === '/load') { await this.tellLoad(store, d, m.chat.id); return true; }

    await this.send(m.chat.id, 'Use the buttons below, send BOL / POD photos, or share your location. For anything else, call your dispatcher.');
    return true;
  }

  private async tellLoad(store: CrmStore, d: DriverInfo, chatId: number) {
    const l = await store.currentLoad(d.ws, d.truckId);
    if (!l) return this.send(chatId, 'No load is assigned to your truck right now.');
    const status = { booked: 'booked', in_transit: 'in transit', delivered: 'delivered' }[l.status as 'booked'] ?? l.status;
    return this.send(chatId, `📋 <b>Your load</b> (${status}): ${this.lane(l)}\nPickup ${esc(l.date)}${l.loadedMiles ? ` · ${l.loadedMiles.toLocaleString('en-US')} mi` : ''}${l.notes ? `\n📝 ${esc(l.notes.slice(0, 300))}` : ''}`);
  }

  private async saveDocument(store: CrmStore, d: DriverInfo, m: DriverMessage) {
    const load = await store.currentLoad(d.ws, d.truckId);
    if (!load) return this.send(m.chat.id, 'No load is assigned to your truck yet, so the document can’t be saved. Send it to your dispatcher directly.');
    const doc = m.document;
    const photo = m.photo?.[m.photo.length - 1];
    const size = doc?.file_size ?? photo?.file_size ?? 0;
    if (size > MAX_FILE) return this.send(m.chat.id, 'That file is over 10 MB — send it as a photo instead.');
    if (doc && !/^(application\/pdf|image\/(jpeg|png))$/.test(doc.mime_type ?? '')) return this.send(m.chat.id, 'Send a photo or a PDF, please.');
    let kind = docKind(m.caption ?? doc?.file_name ?? '', load);
    try {
      const data = await this.api.download((doc ?? photo)!.file_id);
      // No caption: AI (when switched on) looks at the photo to tell a BOL from a POD.
      if (!m.caption && !doc?.file_name) kind = (await classifyDoc(data, doc?.mime_type ?? 'image/jpeg')) ?? kind;
      const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '-');
      const name = doc?.file_name || `${kind.toUpperCase()} ${load.pro || load.id} ${stamp}.jpg`;
      const mime = doc?.mime_type ?? 'image/jpeg';
      await store.addFile(d.ws, load.id, { kind, name, mime, data });
      // A signed POD means the load is delivered, even if the driver didn't tap the button.
      const delivered = kind === 'pod' && (load.status === 'booked' || load.status === 'in_transit');
      if (delivered) await store.setLoadStatus(d.ws, load.id, 'delivered');
      return this.send(m.chat.id, `📄 <b>${kind === 'ratecon' ? 'Rate con' : kind.toUpperCase()}</b> saved to the load ${this.lane(load)}${delivered ? ' — marked <b>delivered</b>' : ''}. Wrong type? Write “BOL” or “POD” as the caption.`);
    } catch (e) {
      this.logger.warn(`Driver document: ${(e as Error).message}`);
      return this.send(m.chat.id, 'Could not save the file — try again in a minute.');
    }
  }
}
