import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AnalyticsService } from '../analytics/analytics.service.js';
import type { TelegramUser } from '../analytics/analytics.types.js';
import { RateLimiter } from '../analytics/rate-limiter.js';
import { config } from '../config.js';

interface TgUser { id: number; is_bot?: boolean; first_name?: string; last_name?: string; username?: string; language_code?: string }
interface TgChat { id: number; type: string; title?: string }
interface TgMessage { message_id: number; chat: TgChat; from?: TgUser; text?: string; caption?: string; reply_to_message?: TgMessage }
export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: { id: string; from: TgUser; data?: string; message?: TgMessage };
  /** The bot's own membership changed, e.g. it was added to a group. */
  my_chat_member?: { chat: TgChat; from: TgUser; old_chat_member: { status: string }; new_chat_member: { status: string } };
}

const isGroup = (chat: TgChat) => chat.type === 'group' || chat.type === 'supergroup';

const WEBHOOK_PATH = '/api/telegram/webhook';
/** How long the bot waits for the suggestion after "Suggest a feature". */
const SUGGESTION_WAIT_MS = 30 * 60_000;
/** Tag on support questions forwarded to the owner; the owner's reply is routed back by it. */
const SUPPORT_TAG = /#u(\d+)\b/;

// Reply-keyboard labels; a tap sends the label as a message.
const BTN_FEATURES = '✨ Features';
const BTN_SUGGEST = '💡 Suggest a feature';
const BTN_SUPPORT = '🆘 Support';
const BTN_WEBSITE = '🌐 Website';
const BTN_OPEN = '⚡ New MC leads';
/** Bot display name. */
const BOT_NAME = 'LeadHaul · New MC leads';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const FEATURES = [
  '✨ <b>What LeadHaul does</b>',
  '',
  '⚡ <b>New MC leads</b>',
  'Carriers that just got their operating authority — today, yesterday, last 7 / 14 / 30 days. Phone + email for each. Most of them don’t have a dispatcher yet.',
  '',
  '🔎 <b>MC scanner</b>',
  'Walks any MC range and keeps only authorized carriers, each verified live on SAFER.',
  '',
  '🏢 <b>Company lookup</b>',
  'Check any company by MC, USDOT, email or phone: authority, insurance history, fleet, cargo, related companies, state registration, liens and courts.',
  '',
  '📥 <b>Export</b>',
  'Excel, Google Sheets, CSV, phone contacts (.vcf) or a printable call sheet.',
  '',
  '🚧 <i>Coming soon: CRM for dispatchers.</i> Tell us what you need — tap “💡 Suggest a feature”.',
].join('\n');

/** Welcome caption under the banner (HTML, fits Telegram's 1024-character caption limit). */
const WELCOME = [
  '⚡ <b>New MC leads with phone &amp; email — every day</b>',
  '',
  'Carriers that just got their operating authority. They don’t have a dispatcher yet — be the first to call.',
  '',
  '🆕 <b>150+</b> new authorized carriers a day',
  '📅 Granted today, yesterday, last 7 / 30 days',
  '📞 Phone + email for every carrier',
  '🔎 Check any MC or USDOT in one tap',
  '📥 Export to Excel, Google Sheets, CSV or contacts',
  '',
  '<i>Free · no sign-up · official FMCSA data</i>',
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
  private readonly supportLimiter = new RateLimiter(20, 10 * 60_000);
  /** The bot's @username, read from Telegram at startup. */
  private username = '';

  constructor(private readonly analytics: AnalyticsService) {}

  get enabled() {
    return !!config.telegramBotToken && config.publicUrl.startsWith('https://');
  }

  /** Public links shown on the website. */
  links() {
    const bot = this.username ? `https://t.me/${this.username}` : '';
    return {
      bot,
      group: config.telegramGroupUrl,
      // Opens the bot straight in "ask a question" mode.
      support: bot && this.supportEnabled ? `${bot}?start=support` : '',
    };
  }

  private get siteUrl() {
    return config.publicUrl + '/';
  }

  private get botUrl() {
    return this.username ? `https://t.me/${this.username}` : this.siteUrl;
  }

  /** "Join our group" button row, when the group link is configured. */
  private groupRow() {
    return config.telegramGroupUrl ? [[{ text: '👥 Join our Telegram group', url: config.telegramGroupUrl }]] : [];
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
    const me = (await this.call('getMe', {})) as { username?: string };
    this.username = me.username ?? '';
    await this.call('setWebhook', {
      url: config.publicUrl + WEBHOOK_PATH,
      secret_token: this.webhookSecret,
      allowed_updates: ['message', 'callback_query', 'my_chat_member'],
    });
    await this.call('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Leads', web_app: { url: this.viewUrl('leads') } } });
    await this.call('setMyCommands', {
      commands: [
        { command: 'start', description: 'New MC leads & MC scanner' },
        { command: 'features', description: 'What LeadHaul can do' },
        { command: 'suggest', description: 'Suggest a feature' },
        { command: 'support', description: 'Ask a question / get help' },
        { command: 'website', description: 'Link to the website' },
      ],
    });
    // Display name; Telegram only allows changing it a few times a day, so skip when it is already set.
    const name = (await this.call('getMyName', {}).catch(() => ({}))) as { name?: string };
    if (name.name !== BOT_NAME) await this.call('setMyName', { name: BOT_NAME }).catch(() => {});
    await this.call('setMyShortDescription', {
      short_description: `New MC leads every day: carriers that just got authority, with phone & email. Free. ${this.siteUrl}`,
    });
    this.logger.log(`Telegram bot webhook set to ${config.publicUrl}${WEBHOOK_PATH}`);
  }

  async handle(update: TgUpdate): Promise<unknown> {
    if (update.callback_query) return this.handleButton(update.callback_query);
    if (update.my_chat_member) return this.handleMembership(update.my_chat_member);
    const msg = update.message;
    if (!msg || !msg.from || msg.from.is_bot) return;
    if (isGroup(msg.chat)) return this.handleGroupMessage(msg);
    if (msg.chat.type !== 'private') return;
    const tg = this.tgUser(msg.from);
    const text = (msg.text ?? '').trim();
    const [first, ...rest] = text.split(/\s+/);
    const command = first.startsWith('/') ? first.slice(1).split('@')[0].toLowerCase() : '';

    // The owner answers a support question by replying to the forwarded message.
    const replyTag = msg.reply_to_message?.text?.match(SUPPORT_TAG);
    if (this.isOwner(msg.from.id) && replyTag && !command) return this.answerSupport(Number(replyTag[1]), msg);

    if (command === 'start') {
      await this.track('bot_start', tg, { text: text.slice(0, 100), language: msg.from.language_code ?? '' });
      // t.me/<bot>?start=support (the website's Support button) opens straight into a question.
      if (rest[0] === 'support') return this.askSupport(msg.chat.id, tg);
      return this.sendWelcome(msg.chat.id);
    }
    if (command === 'support' || command === 'help' || text === BTN_SUPPORT) {
      const inline = rest.join(' ');
      if (command && inline) return this.forwardSupport(msg.chat.id, tg, inline);
      return this.askSupport(msg.chat.id, tg);
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
    // Anything else a person writes is a question for support (when the owner is set up to receive it).
    const freeText = text || (msg.caption ?? '').trim();
    if (!command && freeText && this.supportEnabled) return this.forwardSupport(msg.chat.id, tg, freeText);
    await this.track('bot_message', tg, { text: text.slice(0, 100) });
    await this.send(msg.chat.id, 'Choose an option below — or tap “💡 Suggest a feature” to send us an idea.', this.mainKeyboard());
  }

  private get supportEnabled() {
    return config.ownerTelegramId > 0;
  }

  private isOwner(userId: number) {
    return this.supportEnabled && userId === config.ownerTelegramId;
  }

  private async askSupport(chatId: number, tg: TelegramUser) {
    await this.track('bot_support_open', tg);
    if (!this.supportEnabled) {
      return this.send(chatId, 'Support is not available right now. You can ask in our Telegram group.', {
        inline_keyboard: this.groupRow(),
      });
    }
    await this.send(chatId, [
      '🆘 <b>Support</b>',
      '',
      'Write your question in one message — how to use the scanner, a problem, anything. We will answer right here in this chat.',
    ].join('\n'), { force_reply: true, input_field_placeholder: 'Your question…' });
  }

  /** Sends the user's question to the owner, tagged so that the owner's reply finds its way back. */
  private async forwardSupport(chatId: number, tg: TelegramUser, text: string) {
    this.awaitingSuggestion.delete(chatId);
    if (!this.supportLimiter.take(String(tg.id))) {
      return this.send(chatId, 'You have sent many messages — we will answer soon, please wait a bit.', this.mainKeyboard());
    }
    await this.track('bot_support_message', tg, { length: text.length });
    const who = [tg.name, tg.username ? `@${tg.username}` : ''].filter(Boolean).join(' ') || 'Someone';
    await this.send(config.ownerTelegramId, [
      `🆘 <b>Support question</b> #u${tg.id}`,
      `From: ${esc(who)} (id ${tg.id})`,
      '',
      esc(text.slice(0, 3500)),
      '',
      '↩️ <i>Reply to this message to answer — the bot will deliver it.</i>',
    ].join('\n'));
    await this.send(chatId, '✅ Your message has been sent to support. We will reply here, usually within a few hours.', this.mainKeyboard());
  }

  /** Delivers the owner's reply to the user who asked. */
  private async answerSupport(userId: number, reply: TgMessage) {
    const text = (reply.text ?? reply.caption ?? '').trim();
    if (!text) return this.send(reply.chat.id, 'Only text replies can be delivered.');
    try {
      await this.send(userId, `💬 <b>LeadHaul support:</b>\n\n${esc(text.slice(0, 3800))}`, this.mainKeyboard());
      await this.send(reply.chat.id, '✅ Delivered.');
    } catch (e) {
      await this.send(reply.chat.id, `❌ Not delivered: ${esc((e as Error).message)}`);
    }
  }

  /** Added to a group: post the intro with links to the bot and the website, and pin it. */
  private async handleMembership(m: NonNullable<TgUpdate['my_chat_member']>) {
    if (!isGroup(m.chat)) return;
    const was = ['member', 'administrator', 'creator'].includes(m.old_chat_member.status);
    const now = ['member', 'administrator'].includes(m.new_chat_member.status);
    this.logger.log(`Group "${m.chat.title ?? ''}" (chat id ${m.chat.id}): bot is now ${m.new_chat_member.status}`);
    // Post once when added, and again when promoted to admin so the intro can be pinned.
    if (!now || (was && m.new_chat_member.status !== 'administrator')) return;
    await this.track('bot_added_to_group', this.tgUser(m.from), { chat: m.chat.id, title: m.chat.title ?? '', status: m.new_chat_member.status });
    await this.postGroupIntro(m.chat.id, true);
  }

  /** In groups the bot only answers its commands (privacy mode): /start, /about, /features, /website. */
  private async handleGroupMessage(msg: TgMessage) {
    const first = (msg.text ?? '').trim().split(/\s+/)[0];
    if (!first.startsWith('/')) return;
    const [cmd, mention] = first.slice(1).toLowerCase().split('@');
    if (mention && this.username && mention !== this.username.toLowerCase()) return;
    if (cmd === 'start' || cmd === 'about' || cmd === 'website') return this.postGroupIntro(msg.chat.id, false);
    if (cmd === 'features') return this.sendFeatures(msg.chat.id, true);
  }

  private async postGroupIntro(chatId: number, pin: boolean) {
    const sent = (await this.send(chatId, [
      '⚡ <b>LeadHaul — new MC leads every day</b>',
      '',
      '🆕 Carriers that just got their operating authority, with phone and email — most have no dispatcher yet.',
      '🔎 Scan any MC range for authorized carriers, verified live on SAFER.',
      '🏢 Check any company by MC, USDOT, email or phone: authority, insurance, fleet, state registration, liens and courts.',
      '🚧 Coming soon: CRM for dispatchers.',
      '',
      `🤖 Bot: @${this.username || 'LeadHaul'} — tap the button below and press Start`,
      `🌐 Website: ${this.siteUrl}`,
      '',
      '💡 Ideas and requests are welcome here or in the bot.',
    ].join('\n'), {
      inline_keyboard: [
        [{ text: '🤖 Open the bot', url: `${this.botUrl}?start=group` }],
        [{ text: '🌐 Open the website', url: this.siteUrl }],
      ],
    })) as { message_id?: number };
    if (pin && sent?.message_id) {
      // Needs the "Pin messages" admin right; without it the intro simply stays unpinned.
      await this.call('pinChatMessage', { chat_id: chatId, message_id: sent.message_id, disable_notification: true })
        .catch((e: Error) => this.logger.warn(`Could not pin the intro in ${chatId}: ${e.message}`));
    }
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
    if (q.data === 'support') return this.askSupport(chatId, tg);
  }

  /** Site URL opening a given view (Telegram adds its own data to the hash, so the view goes in the query). */
  private viewUrl(view: 'leads' | 'lookup' | 'scan') {
    return `${this.siteUrl}?view=${view}`;
  }

  private async sendWelcome(chatId: number) {
    const keyboard = {
      inline_keyboard: [
        [{ text: '⚡ Get new MC leads', web_app: { url: this.viewUrl('leads') } }],
        [{ text: '🔎 Check a company', web_app: { url: this.viewUrl('lookup') } }, { text: '🌐 Website', url: this.siteUrl }],
        [{ text: '✨ Features', callback_data: 'features' }, { text: '💡 Suggest a feature', callback_data: 'suggest' }],
        ...(this.supportEnabled ? [[{ text: '🆘 Support — ask a question', callback_data: 'support' }]] : []),
        ...this.groupRow(),
      ],
    };
    try {
      await this.call('sendPhoto', {
        chat_id: chatId,
        photo: `${this.siteUrl}new-mc-leads.jpg`,
        caption: WELCOME,
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
    } catch (e) {
      // The banner is a nice-to-have: fall back to text if Telegram cannot fetch it.
      this.logger.warn(`Welcome photo failed: ${(e as Error).message}`);
      await this.send(chatId, WELCOME, keyboard);
    }
    await this.send(chatId, 'The menu below is always here 👇', this.mainKeyboard());
  }

  /** Mini App (web_app) buttons only work in private chats, so groups get plain links. */
  private sendFeatures(chatId: number, inGroup = false) {
    return this.send(chatId, FEATURES, {
      inline_keyboard: inGroup
        ? [[{ text: '🤖 Open the bot', url: `${this.botUrl}?start=group` }, { text: '🌐 Website', url: this.siteUrl }]]
        : [
            [{ text: '⚡ Get new MC leads', web_app: { url: this.viewUrl('leads') } }, { text: '🌐 Website', url: this.siteUrl }],
            [{ text: '💡 Suggest a feature', callback_data: 'suggest' }],
            ...this.groupRow(),
          ],
    });
  }

  private sendWebsite(chatId: number) {
    return this.send(chatId, `🌐 LeadHaul website:\n${this.siteUrl}\n\nWorks in any browser, on phone and desktop.`, {
      inline_keyboard: [
        [{ text: '🌐 Open website', url: this.siteUrl }],
        [{ text: '⚡ Get new MC leads', web_app: { url: this.viewUrl('leads') } }],
        ...this.groupRow(),
      ],
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
        [{ text: BTN_OPEN, web_app: { url: this.viewUrl('leads') } }],
        [{ text: BTN_FEATURES }, { text: BTN_SUGGEST }],
        this.supportEnabled ? [{ text: BTN_SUPPORT }, { text: BTN_WEBSITE }] : [{ text: BTN_WEBSITE }],
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
