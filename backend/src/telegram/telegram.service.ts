import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AnalyticsService } from '../analytics/analytics.service.js';
import { config } from '../config.js';

interface TgUser { id: number; is_bot?: boolean; first_name?: string; last_name?: string; username?: string; language_code?: string }
export interface TgUpdate {
  update_id: number;
  message?: { message_id: number; chat: { id: number; type: string }; from?: TgUser; text?: string };
}

const WEBHOOK_PATH = '/api/telegram/webhook';

const WELCOME = [
  '<b>MC Scanner</b> — free FMCSA carrier lookup.',
  '',
  '• <b>Scanner</b>: walks MC numbers one by one and collects authorized carriers with phone and email.',
  '• <b>Lookup</b>: check one company by MC, USDOT, email or phone — authority, insurance, live SAFER, state registration, liens and courts.',
  '',
  'Tap the button below to open it.',
].join('\n');

@Injectable()
export class TelegramService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TelegramService.name);
  /** Telegram echoes this in X-Telegram-Bot-Api-Secret-Token so forged webhook calls can be rejected. */
  readonly webhookSecret = config.telegramBotToken
    ? createHash('sha256').update('webhook:' + config.telegramBotToken).digest('hex').slice(0, 48)
    : '';

  constructor(private readonly analytics: AnalyticsService) {}

  get enabled() {
    return !!config.telegramBotToken && config.publicUrl.startsWith('https://');
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

  /** Point the bot at this server and give every chat an "Open" menu button that launches the Mini App. */
  private async setup() {
    const app = { url: config.publicUrl + '/' };
    await this.call('setWebhook', {
      url: config.publicUrl + WEBHOOK_PATH,
      secret_token: this.webhookSecret,
      allowed_updates: ['message'],
    });
    await this.call('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Open', web_app: app } });
    await this.call('setMyCommands', { commands: [{ command: 'start', description: 'Open MC Scanner' }] });
    await this.call('setMyShortDescription', { short_description: 'Free FMCSA carrier lookup: MC scanner, SAFER, insurance, registrations.' });
    this.logger.log(`Telegram bot webhook set to ${config.publicUrl}${WEBHOOK_PATH}`);
  }

  async handle(update: TgUpdate): Promise<void> {
    const msg = update.message;
    if (!msg || msg.chat.type !== 'private' || !msg.from || msg.from.is_bot) return;
    const from = msg.from;
    const tg = { id: from.id, username: from.username ?? '', name: [from.first_name, from.last_name].filter(Boolean).join(' ') };
    const command = (msg.text ?? '').trim().split(/\s+/)[0].toLowerCase();
    await this.analytics.recordServer(command === '/start' ? 'bot_start' : 'bot_message', {
      text: (msg.text ?? '').slice(0, 100),
      language: from.language_code ?? '',
    }, tg);

    await this.call('sendMessage', {
      chat_id: msg.chat.id,
      text: WELCOME,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: '🚚 Open MC Scanner', web_app: { url: config.publicUrl + '/' } }]] },
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
