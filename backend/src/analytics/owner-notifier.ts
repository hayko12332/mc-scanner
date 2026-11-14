import { Logger } from '@nestjs/common';
import type { StoredEvent, StoredFeedback } from './analytics.types.js';

export interface NotifierOptions {
  /** Telegram user id that receives the alerts (must have started the bot); 0 turns alerts off. */
  ownerTelegramId: number;
  /** Browser visitor ids of the owner, so their own visits are not reported. */
  ownerVisitorIds: string[];
  /** Sends one plain-text message to the owner. */
  send: (chatId: number, text: string) => Promise<unknown>;
}

/** Actions reported once per visitor (per server run), besides the first visit itself. */
const FIRST_ACTIONS = new Set(['leads_start', 'scan_start', 'lookup', 'csv_export']);
const MAX_REMEMBERED = 5000;

/** Turns a two-letter country code into its flag emoji ("US" -> 🇺🇸). */
export function flag(country: string): string {
  return /^[A-Z]{2}$/.test(country)
    ? String.fromCodePoint(...[...country].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
    : '';
}

/** Rough device name from a User-Agent string. */
export function device(userAgent: string): string {
  if (/Android/i.test(userAgent)) return 'Android';
  if (/iPhone|iPad|iOS/i.test(userAgent)) return 'iPhone';
  if (/Windows/i.test(userAgent)) return 'Windows';
  if (/Macintosh|Mac OS/i.test(userAgent)) return 'Mac';
  if (/Linux/i.test(userAgent)) return 'Linux';
  return '';
}

/** Crawlers, link previews and headless browsers: they open pages but are not people, so no alert. */
export const isBotAgent = (userAgent: string) =>
  /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|python|curl|wget|httpclient|scrapy|phantom|puppeteer|playwright/i.test(userAgent);

function who(e: { country: string; userAgent: string; tgUsername: string; tgName: string }): string {
  const place = [flag(e.country) + (e.country ? ` ${e.country}` : ''), device(e.userAgent)].filter(Boolean).join(', ');
  const tg = e.tgUsername ? `@${e.tgUsername}` : e.tgName;
  return [tg, place].filter(Boolean).join(' · ') || 'unknown';
}

/**
 * Messages the site owner in Telegram when someone new shows up, starts using the tools, opens the bot or
 * leaves a suggestion. Never throws: alerts must not break analytics.
 */
export class OwnerNotifier {
  private readonly logger = new Logger(OwnerNotifier.name);
  private readonly reported = new Set<string>();

  constructor(private readonly o: NotifierOptions) {}

  get enabled() {
    return this.o.ownerTelegramId > 0;
  }

  /** Builds the alert texts for one batch of site events; `isNewVisitor` = first time this visitor is seen. */
  siteAlerts(events: StoredEvent[], isNewVisitor: boolean): string[] {
    const first = events[0];
    if (!first || this.isOwner(first.visitorId, first.tgUserId) || isBotAgent(first.userAgent ?? '')) return [];
    const texts: string[] = [];
    if (isNewVisitor) {
      const page = events.find((e) => e.event === 'page_view')?.props.page;
      const from = first.referrer ? `\nОткуда: ${first.referrer}` : first.tgUserId ? '\nОткуда: Telegram Mini App' : '';
      texts.push(`👀 Новый посетитель на сайте\n${who(first)}${page ? `\nСтраница: ${page}` : ''}${from}`);
    }
    for (const e of events) {
      if (!FIRST_ACTIONS.has(e.event) || !this.remember(`${e.visitorId}:${e.event}`)) continue;
      const p = e.props;
      if (e.event === 'scan_start') texts.push(`▶️ Запустил скан с MC ${p.from}${p.to ? ` до ${p.to}` : ''}\n${who(e)}`);
      if (e.event === 'lookup') texts.push(`🔎 Ищет компанию: ${p.q} (найдено: ${p.results})\n${who(e)}`);
      if (e.event === 'leads_start') texts.push(`⚡ Загружает New MC leads за ${p.days} дн.\n${who(e)}`);
      if (e.event === 'csv_export') texts.push(`⬇️ Экспорт ${String(p.format ?? 'csv').toUpperCase()}: ${p.rows} перевозчиков\n${who(e)}`);
    }
    return texts;
  }

  botStartAlert(e: StoredEvent): string | null {
    if (this.isOwner(e.visitorId, e.tgUserId)) return null;
    return `🤖 /start в боте\n${who(e)}${e.tgUserId ? ` (id ${e.tgUserId})` : ''}`;
  }

  feedbackAlert(f: StoredFeedback): string | null {
    if (this.isOwner(f.visitorId, f.tgUserId)) return null;
    return `💬 Новое предложение\n${f.message}${f.contact ? `\nКонтакт: ${f.contact}` : ''}\n${who(f)}`;
  }

  /** Sends the texts in order; failures are only logged. */
  async send(texts: (string | null)[]): Promise<void> {
    if (!this.enabled) return;
    for (const text of texts) {
      if (!text) continue;
      try {
        await this.o.send(this.o.ownerTelegramId, text.slice(0, 4000));
      } catch (e) {
        this.logger.warn(`Could not notify the owner: ${(e as Error).message}`);
      }
    }
  }

  private isOwner(visitorId: string, tgUserId: number | null) {
    return tgUserId === this.o.ownerTelegramId || visitorId === `tg:${this.o.ownerTelegramId}` ||
      this.o.ownerVisitorIds.includes(visitorId);
  }

  /** True the first time a key is seen; the memory is bounded so a long-running server does not grow. */
  private remember(key: string) {
    if (this.reported.has(key)) return false;
    if (this.reported.size >= MAX_REMEMBERED) this.reported.clear();
    this.reported.add(key);
    return true;
  }
}
