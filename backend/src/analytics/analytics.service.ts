import { BadRequestException, Injectable, Logger, ServiceUnavailableException, type OnModuleDestroy } from '@nestjs/common';
import { config } from '../config.js';
import { createStore, type AnalyticsStore } from './analytics.store.js';
import type { EventBatch, FeedbackInput, StoredEvent, TelegramUser } from './analytics.types.js';
import { verifyInitData } from './telegram-auth.js';

/** Request facts the server adds to every event. */
export interface RequestContext {
  ip: string;
  country: string;
  userAgent: string;
}

const EVENT_NAME = /^[a-z][a-z0-9_]{0,39}$/;
const ID = /^[A-Za-z0-9:_-]{6,64}$/;
const MAX_BATCH = 50;
const MAX_PROPS_JSON = 2000;
const MAX_FEEDBACK = 3000;

const clip = (s: unknown, n: number) => (typeof s === 'string' ? s.slice(0, n) : '');

@Injectable()
export class AnalyticsService implements OnModuleDestroy {
  private readonly logger = new Logger(AnalyticsService.name);
  private readonly store: AnalyticsStore = createStore(config.databaseUrl, config.analyticsFile);

  /** Validate and store a browser batch; returns how many events were kept. */
  async recordBatch(batch: EventBatch, ctx: RequestContext): Promise<number> {
    if (!batch || !ID.test(batch.visitorId ?? '') || !ID.test(batch.sessionId ?? '') || !Array.isArray(batch.events)) {
      return 0;
    }
    const tg = verifyInitData(clip(batch.tgInitData, 4096), config.telegramBotToken);
    const now = Date.now();
    const events: StoredEvent[] = batch.events.slice(0, MAX_BATCH).flatMap((e) => {
      if (!e || !EVENT_NAME.test(e.event ?? '')) return [];
      const props = e.props && typeof e.props === 'object' && !Array.isArray(e.props) ? e.props : {};
      if (JSON.stringify(props).length > MAX_PROPS_JSON) return [];
      // Trust the client clock only within the last hour (events are queued for a few seconds).
      const at = Date.parse(e.at ?? '');
      return [this.event(e.event, props, {
        at: Number.isFinite(at) && at <= now && now - at < 3_600_000 ? new Date(at) : new Date(now),
        visitorId: batch.visitorId,
        sessionId: batch.sessionId,
        path: clip(e.path, 300),
        referrer: clip(batch.referrer, 300),
        ctx,
        tg,
      })];
    });
    await this.save(events);
    return events.length;
  }

  /** Server-side event, e.g. a Telegram /start. */
  async recordServer(event: string, props: Record<string, unknown>, tg: TelegramUser | null): Promise<void> {
    const id = tg ? `tg:${tg.id}` : 'server';
    await this.save([this.event(event, props, {
      at: new Date(), visitorId: id, sessionId: id, path: '', referrer: '',
      ctx: { ip: '', country: '', userAgent: '' }, tg,
    })]);
  }

  /** Store a suggestion. Unlike analytics, a failure is reported so the user knows it was not saved. */
  async recordFeedback(input: FeedbackInput, ctx: RequestContext, botUser?: TelegramUser): Promise<void> {
    const message = clip(input?.message, MAX_FEEDBACK).trim();
    if (message.length < 3) throw new BadRequestException('Please write a few words.');
    // From the bot the Telegram user is known for sure; from the site it comes from signed Mini App data.
    const tg = botUser ?? verifyInitData(clip(input.tgInitData, 4096), config.telegramBotToken);
    const visitorId = ID.test(input.visitorId ?? '') ? input.visitorId! : '';
    try {
      await this.store.insertFeedback({
        at: new Date().toISOString(),
        message,
        contact: clip(input.contact, 200).trim(),
        page: clip(input.page, 300),
        visitorId,
        ip: ctx.ip,
        country: ctx.country,
        userAgent: clip(ctx.userAgent, 400),
        tgUserId: tg?.id ?? null,
        tgUsername: tg?.username ?? '',
        tgName: tg?.name ?? '',
      });
    } catch (e) {
      this.logger.error(`Could not store feedback: ${(e as Error).message}`);
      throw new ServiceUnavailableException('Could not save your suggestion right now, please try again later.');
    }
    if (visitorId) {
      await this.save([this.event('feedback_sent', { length: message.length }, {
        at: new Date(), visitorId, sessionId: visitorId, path: clip(input.page, 300), referrer: '', ctx, tg,
      })]);
    }
  }

  onModuleDestroy() {
    return this.store.close();
  }

  private event(
    event: string,
    props: Record<string, unknown>,
    o: { at: Date; visitorId: string; sessionId: string; path: string; referrer: string; ctx: RequestContext; tg: TelegramUser | null },
  ): StoredEvent {
    return {
      at: o.at.toISOString(),
      visitorId: o.visitorId,
      sessionId: o.sessionId,
      event,
      props,
      path: o.path,
      ip: o.ctx.ip,
      country: o.ctx.country,
      userAgent: clip(o.ctx.userAgent, 400),
      referrer: o.referrer,
      tgUserId: o.tg?.id ?? null,
      tgUsername: o.tg?.username ?? '',
      tgName: o.tg?.name ?? '',
    };
  }

  private async save(events: StoredEvent[]) {
    try {
      await this.store.insert(events);
    } catch (e) {
      // Analytics must never break the site.
      this.logger.error(`Could not store ${events.length} events: ${(e as Error).message}`);
    }
  }
}
