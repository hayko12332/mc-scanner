import { describe, expect, it } from 'vitest';
import type { StoredEvent } from './analytics.types.js';
import { device, flag, OwnerNotifier } from './owner-notifier.js';

const OWNER = 111;
const ANDROID = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/150 Mobile Safari/537.36';

const ev = (event: string, props: Record<string, unknown> = {}, o: Partial<StoredEvent> = {}): StoredEvent => ({
  at: '2026-11-09T16:39:47.000Z', visitorId: 'visitor-1', sessionId: 'session-1', event, props, path: '#/',
  ip: '', country: 'CO', userAgent: ANDROID, referrer: '', tgUserId: null, tgUsername: '', tgName: '', ...o,
});

function notifier() {
  const sent: [number, string][] = [];
  const n = new OwnerNotifier({
    ownerTelegramId: OWNER,
    ownerVisitorIds: ['owner-browser'],
    send: async (chatId, text) => void sent.push([chatId, text]),
  });
  return { n, sent };
}

describe('OwnerNotifier', () => {
  it('reports a new visitor with country, device and page', () => {
    const { n } = notifier();
    const [text] = n.siteAlerts([ev('page_view', { page: 'scanner' })], true);
    expect(text).toContain('Новый посетитель');
    expect(text).toContain('🇨🇴 CO, Android');
    expect(text).toContain('scanner');
  });

  it('does not report a returning visitor page view', () => {
    const { n } = notifier();
    expect(n.siteAlerts([ev('page_view', { page: 'lookup' })], false)).toEqual([]);
  });

  it('reports the first scan and lookup of a visitor only once', () => {
    const { n } = notifier();
    const scan = ev('scan_start', { from: '986552', to: null });
    const lookup = ev('lookup', { q: '986552', results: 2 });
    expect(n.siteAlerts([scan, lookup], false)).toEqual([
      expect.stringContaining('скан с MC 986552'),
      expect.stringContaining('Ищет компанию: 986552 (найдено: 2)'),
    ]);
    expect(n.siteAlerts([scan, lookup], false)).toEqual([]);
  });

  it('never reports the owner, by browser or by Telegram account', () => {
    const { n } = notifier();
    expect(n.siteAlerts([ev('page_view', {}, { visitorId: 'owner-browser' })], true)).toEqual([]);
    expect(n.siteAlerts([ev('scan_start', { from: 1 }, { tgUserId: OWNER })], true)).toEqual([]);
    expect(n.botStartAlert(ev('bot_start', {}, { visitorId: `tg:${OWNER}`, tgUserId: OWNER }))).toBeNull();
  });

  it('reports bot /start and suggestions, and sends to the owner chat', async () => {
    const { n, sent } = notifier();
    const start = n.botStartAlert(ev('bot_start', {}, { visitorId: 'tg:467', tgUserId: 467, tgUsername: 'max', country: '', userAgent: '' }));
    const idea = n.feedbackAlert({
      at: '', message: 'Add a CRM', contact: '@max', page: '', visitorId: 'v', ip: '', country: 'US', userAgent: '',
      tgUserId: null, tgUsername: '', tgName: '',
    });
    await n.send([start, idea, null]);
    expect(sent.map(([chat]) => chat)).toEqual([OWNER, OWNER]);
    expect(sent[0][1]).toContain('/start в боте\n@max (id 467)');
    expect(sent[1][1]).toContain('Add a CRM\nКонтакт: @max\n🇺🇸 US');
  });

  it('is off without an owner id and never throws when sending fails', async () => {
    const off = new OwnerNotifier({ ownerTelegramId: 0, ownerVisitorIds: [], send: async () => { throw new Error('x'); } });
    await expect(off.send(['hi'])).resolves.toBeUndefined();
    const failing = new OwnerNotifier({ ownerTelegramId: 1, ownerVisitorIds: [], send: async () => { throw new Error('down'); } });
    await expect(failing.send(['hi'])).resolves.toBeUndefined();
  });
});

describe('tool alerts', () => {
  it('reports leads loading and the export format', () => {
    const { n } = notifier();
    const texts = n.siteAlerts([ev('leads_start', { days: 7 }), ev('csv_export', { rows: 5, format: 'xlsx' })], false);
    expect(texts.join('\n')).toContain('New MC leads за 7');
    expect(texts.join('\n')).toContain('Экспорт XLSX: 5');
  });
});

describe('flag and device', () => {
  it('maps country codes and user agents', () => {
    expect(flag('AM')).toBe('🇦🇲');
    expect(flag('')).toBe('');
    expect(device(ANDROID)).toBe('Android');
    expect(device('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe('iPhone');
    expect(device('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('Mac');
  });
});
