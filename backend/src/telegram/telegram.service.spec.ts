import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../config.js';
import { TelegramService, type TgUpdate } from './telegram.service.js';

const from = { id: 42, first_name: 'Ann', username: 'ann' };
const msg = (text: string, update_id = 1): TgUpdate => ({
  update_id, message: { message_id: update_id, chat: { id: 42, type: 'private' }, from, text },
});

describe('TelegramService', () => {
  let sent: { method: string; body: Record<string, unknown> }[];
  let analytics: { recordServer: ReturnType<typeof vi.fn>; recordFeedback: ReturnType<typeof vi.fn> };
  let bot: TelegramService;

  beforeEach(() => {
    Object.assign(config, { telegramBotToken: '1:TEST', publicUrl: 'https://scanner.example', ownerTelegramId: 0 });
    sent = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: { body: string }) => {
      const method = url.split('/').pop()!;
      sent.push({ method, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ ok: true, result: method === 'sendMessage' ? { message_id: 7 } : true }));
    }));
    analytics = { recordServer: vi.fn(async () => {}), recordFeedback: vi.fn(async () => {}) };
    bot = new TelegramService(analytics as never);
  });
  afterEach(() => vi.unstubAllGlobals());

  const texts = () => sent.filter((s) => s.method === 'sendMessage').map((s) => String(s.body.text));
  const markup = (i: number) => JSON.stringify(sent.filter((s) => s.method === 'sendMessage')[i].body.reply_markup);

  it('/start sends the banner with a caption, the New MC leads Mini App button, a website link and the menu', async () => {
    await bot.handle(msg('/start'));
    const photo = sent.find((s) => s.method === 'sendPhoto')!;
    expect(photo.body.photo).toBe('https://scanner.example/new-mc-leads.jpg');
    expect(String(photo.body.caption)).toContain('New MC leads');
    expect(String(photo.body.caption).length).toBeLessThanOrEqual(1024);
    const kb = JSON.stringify(photo.body.reply_markup);
    expect(kb).toContain('"web_app":{"url":"https://scanner.example/?view=leads"}');
    expect(kb).toContain('"url":"https://scanner.example/"');
    expect(markup(0)).toContain('💡 Suggest a feature');
    expect(analytics.recordServer).toHaveBeenCalledWith('bot_start', expect.anything(), { id: 42, username: 'ann', name: 'Ann' });
  });

  it('the Features button lists the features', async () => {
    await bot.handle(msg('✨ Features'));
    expect(texts()[0]).toContain('New MC leads');
  });

  it('saves the message after "Suggest a feature" as a suggestion', async () => {
    await bot.handle(msg('💡 Suggest a feature', 1));
    expect(texts()[0]).toContain('What would you like to see?');
    await bot.handle(msg('Export to Google Sheets please', 2));
    expect(analytics.recordFeedback).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Export to Google Sheets please', contact: '@ann', page: 'telegram-bot' }),
      expect.anything(),
      { id: 42, username: 'ann', name: 'Ann' },
    );
    expect(texts()[1]).toContain('Thank you');
    // The next free text is not a suggestion any more.
    await bot.handle(msg('hello', 3));
    expect(analytics.recordFeedback).toHaveBeenCalledTimes(1);
  });

  it('/suggest with text saves it directly; inline buttons work', async () => {
    await bot.handle(msg('/suggest Add a truck count filter'));
    expect(analytics.recordFeedback).toHaveBeenCalledWith(expect.objectContaining({ message: 'Add a truck count filter' }), expect.anything(), expect.anything());
    await bot.handle({ update_id: 9, callback_query: { id: 'q1', from, data: 'features', message: { message_id: 1, chat: { id: 42, type: 'private' } } } });
    expect(sent.some((s) => s.method === 'answerCallbackQuery')).toBe(true);
    expect(texts().at(-1)).toContain('What MC Scanner does');
  });

  describe('support', () => {
    const OWNER = 777;
    beforeEach(() => Object.assign(config, { ownerTelegramId: OWNER }));
    const ownerReply = (text: string, quoted: string): TgUpdate => ({
      update_id: 50,
      message: {
        message_id: 50, chat: { id: OWNER, type: 'private' }, from: { id: OWNER, first_name: 'Owner' }, text,
        reply_to_message: { message_id: 7, chat: { id: OWNER, type: 'private' }, text: quoted },
      },
    });

    it('?start=support asks for the question, which is forwarded to the owner with a tag', async () => {
      await bot.handle(msg('/start support', 1));
      expect(texts()[0]).toContain('Support');
      await bot.handle(msg('How do I export <emails>?', 2));
      const toOwner = sent.find((s) => s.method === 'sendMessage' && s.body.chat_id === OWNER)!;
      expect(String(toOwner.body.text)).toContain('#u42');
      expect(String(toOwner.body.text)).toContain('Ann @ann');
      expect(String(toOwner.body.text)).toContain('How do I export &lt;emails&gt;?');
      expect(texts().at(-1)).toContain('sent to support');
    });

    it('free text goes to support; the owner reply is delivered back to the user', async () => {
      await bot.handle(msg('hello, is it free?', 3));
      expect(sent.some((s) => s.body.chat_id === OWNER)).toBe(true);
      sent = [];
      await bot.handle(ownerReply('Yes, totally free.', '🆘 Support question #u42\nFrom: Ann @ann (id 42)'));
      const toUser = sent.find((s) => s.method === 'sendMessage' && s.body.chat_id === 42)!;
      expect(String(toUser.body.text)).toContain('Yes, totally free.');
      expect(texts().at(-1)).toContain('Delivered');
    });

    it('the support link is published only when support is on', () => {
      (bot as unknown as { username: string }).username = 'TestBot';
      expect(bot.links().support).toBe('https://t.me/TestBot?start=support');
      Object.assign(config, { ownerTelegramId: 0 });
      expect(bot.links().support).toBe('');
    });
  });

  it('posts and pins the intro when added to a group as admin, with plain links only', async () => {
    await bot.handle({
      update_id: 20,
      my_chat_member: {
        chat: { id: -100, type: 'supergroup', title: 'MC Scanner Community' }, from,
        old_chat_member: { status: 'member' }, new_chat_member: { status: 'administrator' },
      },
    });
    const intro = sent.find((s) => s.method === 'sendMessage')!;
    expect(intro.body.chat_id).toBe(-100);
    expect(String(intro.body.text)).toContain('https://scanner.example/');
    expect(JSON.stringify(intro.body.reply_markup)).not.toContain('web_app');
    expect(sent.some((s) => s.method === 'pinChatMessage')).toBe(true);
  });

  it('ignores plain chatter in groups but answers its commands', async () => {
    const group = (text: string): TgUpdate => ({
      update_id: 30, message: { message_id: 1, chat: { id: -100, type: 'supergroup' }, from, text },
    });
    await bot.handle(group('hello everyone'));
    expect(sent).toHaveLength(0);
    await bot.handle(group('/features'));
    expect(texts()[0]).toContain('What MC Scanner does');
    expect(markup(0)).not.toContain('web_app');
  });

  it('escapes HTML in the echoed suggestion', async () => {
    await bot.handle(msg('/suggest <b>bold</b> & more'));
    expect(texts()[0]).toContain('&lt;b&gt;bold&lt;/b&gt; &amp; more');
  });
});
