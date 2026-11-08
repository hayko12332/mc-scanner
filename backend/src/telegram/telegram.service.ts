import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AnalyticsService } from '../analytics/analytics.service.js';
import type { TelegramUser } from '../analytics/analytics.types.js';
import { RateLimiter } from '../analytics/rate-limiter.js';
import { config } from '../config.js';

interface TgUser { id: number; is_bot?: boolean; first_name?: string; last_name?: string; username?: string; language_code?: string }
interface TgMessage { message_id: number; chat: { id: number; type: string }; from?: TgUser; text?: string }
export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: { id: string; from: TgUser; data?: string; message?: TgMessage };
}

const WEBHOOK_PATH = '/api/telegram/webhook';
/** How long the bot waits for the suggestion after "Suggest a feature". */
const SUGGESTION_WAIT_MS = 30 * 60_000;

// Reply-keyboard labels; a tap sends the label as a message.
const BTN_FEATURES = '✨ Features';
const BTN_SUGGEST = '💡 Suggest a feature';
const BTN_WEBSITE = '🌐 Website';
const BTN_OPEN = '🚚 Open MC Scanner';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const FEATURES = [
  '<b>✨ What MC Scanner does</b>',
  '',
  '🔎 <b>Scanner</b> — walks MC numbers one by one (MC, MC+1, …) and collects authorized carriers with phone and email. Filters: carriers only, active USDOT, with phone. Export to CSV.',
  '✅ <b>Live SAFER check</b> of every carrier it finds.',
  '🏢 <b>Lookup</b> — check one company by MC, USDOT, email or phone: authority, insurance and policy history, fleet, cargo, and other companies that share the same phone or email.',
  '📄 <b>Public records</b> — state business registration, UCC liens, federal court and bankruptcy links.',
  '',
  '🚧 <b>Coming soon: CRM for dispatchers</b> — your carriers, calls, notes and follow-ups in one place.',
  '',
  'Free to use. Have an idea? Tap “💡 Suggest a feature”.',
].join('\n');

@Injectable()
export class TelegramService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TelegramService.name);
  /** Telegram echoes this in X-Telegram-Bot-Api-Secret-Token so forged webhook calls can be rejected. */
  readonly webhookSecret = config.telegramBotToken
    ? createHash('sha256').update('webhook:' + config.telegramBotToken).digest('hex').slice(0, 48)
    : '';
  /** Chats where the next text message is a suggestion (in memory: a restart just asks again). */
  private readonly awaitingSuggestion = new Map<number, number>();
  private readonly suggestionLimiter = new RateLimiter(5, 10 * 60_000);

  constructor(private readonly analytics: AnalyticsService) {}

  get enabled() {
    return !!config.telegramBotToken && config.publicUrl.startsWith('https://');
  }

  private get siteUrl() {
    return config.publicUrl + '/';
  }

  async onApplicationBootstrap() {
    if (!config.telegramBotToken) return;
    if (!this.enabled) {
      this.logger.warn('TELEGRAM_BOT_TOKEN is set but there is no public https URL (PUBLIC_URL / RENDER_EXTERNAL_URL): bot disabled');
      return;
    }
    // Don't block startup: Render needs the health check to pass quickly.
    void this.setup().catch((e: Error) => this.logger.error(`Telegram setup failed: ${e.message}`));
  }

  /** Point the bot at this server, set the "Open" menu button and the command list. */
  private async setup() {
    await this.call('setWebhook', {
      url: config.publicUrl + WEBHOOK_PATH,
      secret_token: this.webhookSecret,
      allowed_updates: ['message', 'callback_query'],
    });
    await this.call('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Open', web_app: { url: this.siteUrl } } });
    await this.call('setMyCommands', {
      commands: [
        { command: 'start', description: 'Open MC Scanner' },
        { command: 'features', description: 'What MC Scanner can do' },
        { command: 'suggest', description: 'Suggest a feature' },
        { command: 'website', description: 'Link to the website' },
      ],
    });
    await this.call('setMyShortDescription', {
      short_description: `Free FMCSA carrier lookup: MC scanner, SAFER, insurance, registrations. ${this.siteUrl}`,
    });
    this.logger.log(`Telegram bot webhook set to ${config.publicUrl}${WEBHOOK_PATH}`);
  }

  async handle(update: TgUpdate): Promise<unknown> {
    if (update.callback_query) return this.handleButton(update.callback_query);
    const msg = update.message;
    if (!msg || msg.chat.type !== 'private' || !msg.from || msg.from.is_bot) return;
    const tg = this.tgUser(msg.from);
    const text = (msg.text ?? '').trim();
    const [first, ...rest] = text.split(/\s+/);
    const command = first.startsWith('/') ? first.slice(1).split('@')[0].toLowerCase() : '';

    if (command === 'start') {
      await this.track('bot_start', tg, { text: text.slice(0, 100), language: msg.from.language_code ?? '' });
      return this.sendWelcome(msg.chat.id);
    }
    if (command === 'features' || text === BTN_FEATURES) {
      await this.track('bot_features', tg);
      return this.sendFeatures(msg.chat.id);
    }
    if (command === 'website' || text === BTN_WEBSITE) {
      await this.track('bot_website', tg);
      return this.sendWebsite(msg.chat.id);
    }
    if (command === 'suggest' || command === 'feedback' || text === BTN_SUGGEST) {
      const inline = rest.join(' ');
      if (command && inline) return this.saveSuggestion(msg.chat.id, tg, inline);
      return this.askSuggestion(msg.chat.id, tg);
    }
    if (!command && text && this.isAwaiting(msg.chat.id)) {
      return this.saveSuggestion(msg.chat.id, tg, text);
    }
    await this.track('bot_message', tg, { text: text.slice(0, 100) });
    await this.send(msg.chat.id, 'Choose an option below — or tap “💡 Suggest a feature” to send us an idea.', this.mainKeyboard());
  }

  private async handleButton(q: NonNullable<TgUpdate['callback_query']>) {
    await this.call('answerCallbackQuery', { callback_query_id: q.id }).catch(() => undefined);
    const chatId = q.message?.chat.id;
    if (!chatId || q.from.is_bot) return;
    const tg = this.tgUser(q.from);
    if (q.data === 'features') {
      await this.track('bot_features', tg);
      return this.sendFeatures(chatId);
    }
    if (q.data === 'suggest') return this.askSuggestion(chatId, tg);
  }

  private sendWelcome(chatId: number) {
    return this.send(chatId, [
      '<b>MC Scanner</b> — free FMCSA carrier lookup.',
      '',
      'Scan MC numbers for authorized carriers with phone and email, or check one company by MC, USDOT, email or phone.',
      '',
      `🌐 Website: ${this.siteUrl}`,
      '🚧 Coming soon: CRM for dispatchers.',
    ].join('\n'), {
      inline_keyboard: [
        [{ text: '🚚 Open in Telegram', web_app: { url: this.siteUrl } }],
        [{ text: '🌐 Open website in browser', url: this.siteUrl }],
        [{ text: '✨ Features', callback_data: 'features' }, { text: '💡 Suggest a feature', callback_data: 'suggest' }],
      ],
    }).then(() => this.send(chatId, 'The menu below is always here 👇', this.mainKeyboard()));
  }

  private sendFeatures(chatId: number) {
    return this.send(chatId, FEATURES, {
      inline_keyboard: [
        [{ text: '🚚 Open in Telegram', web_app: { url: this.siteUrl } }, { text: '🌐 Website', url: this.siteUrl }],
        [{ text: '💡 Suggest a feature', callback_data: 'suggest' }],
      ],
    });
  }

  private sendWebsite(chatId: number) {
    return this.send(chatId, `🌐 MC Scanner website:\n${this.siteUrl}\n\nWorks in any browser, on phone and desktop.`, {
      inline_keyboard: [[{ text: '🌐 Open website', url: this.siteUrl }], [{ text: '🚚 Open in Telegram', web_app: { url: this.siteUrl } }]],
    });
  }

  private async askSuggestion(chatId: number, tg: TelegramUser) {
    this.awaitingSuggestion.set(chatId, Date.now());
    await this.track('bot_suggest_open', tg);
    await this.send(chatId, [
      '💡 <b>What would you like to see?</b>',
      '',
      'Write it in one message: a missing filter, data you need, or what the dispatcher CRM should do. We read every suggestion.',
    ].join('\n'), { force_reply: true, input_field_placeholder: 'Your suggestion…' });
  }

  private async saveSuggestion(chatId: number, tg: TelegramUser, text: string) {
    this.awaitingSuggestion.delete(chatId);
    if (text.length < 3) return this.send(chatId, 'Please write a few words 🙂', this.mainKeyboard());
    if (!this.suggestionLimiter.take(String(tg.id))) {
      return this.send(chatId, 'Thanks! You have sent several suggestions already — please try again a bit later.', this.mainKeyboard());
    }
    await this.analytics.recordFeedback(
      { message: text, contact: tg.username ? `@${tg.username}` : `tg id ${tg.id}`, page: 'telegram-bot', visitorId: `tg:${tg.id}` },
      { ip: '', country: '', userAgent: 'Telegram bot' },
      tg,
    );
    await this.send(chatId, `✅ Thank you! Your suggestion has been saved:\n\n<i>${esc(text.slice(0, 500))}</i>`, this.mainKeyboard());
  }

  private isAwaiting(chatId: number) {
    const since = this.awaitingSuggestion.get(chatId);
    return since != null && Date.now() - since < SUGGESTION_WAIT_MS;
  }

  /** Persistent keyboard under the chat input. */
  private mainKeyboard() {
    return {
      keyboard: [
        [{ text: BTN_OPEN, web_app: { url: this.siteUrl } }],
        [{ text: BTN_FEATURES }, { text: BTN_SUGGEST }],
        [{ text: BTN_WEBSITE }],
      ],
      resize_keyboard: true,
      is_persistent: true,
    };
  }

  private tgUser(from: TgUser): TelegramUser {
    return { id: from.id, username: from.username ?? '', name: [from.first_name, from.last_name].filter(Boolean).join(' ') };
  }

  private track(event: string, tg: TelegramUser, props: Record<string, unknown> = {}) {
    return this.analytics.recordServer(event, props, tg);
  }

  private send(chatId: number, text: string, replyMarkup?: unknown) {
    return this.call('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
  }

  private async call(method: string, body: unknown): Promise<unknown> {
    const res = await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string; result?: unknown };
    if (!data.ok) throw new Error(`${method}: ${data.description ?? `HTTP ${res.status}`}`);
    return data.result;
  }
}
