import { createHmac, timingSafeEqual } from 'node:crypto';
import type { TelegramUser } from './analytics.types.js';

const MAX_AGE_SECONDS = 7 * 24 * 3600;

/**
 * Verify Telegram Mini App initData (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)
 * and return the user it was issued for, or null if it is missing, forged or too old.
 */
export function verifyInitData(initData: string, botToken: string, now = Date.now()): TelegramUser | null {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return null;
  params.delete('hash');
  const checkString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(checkString).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, 'hex'))) return null;

  const authDate = Number(params.get('auth_date'));
  if (!authDate || now / 1000 - authDate > MAX_AGE_SECONDS) return null;
  try {
    const user = JSON.parse(params.get('user') ?? '') as { id?: number; username?: string; first_name?: string; last_name?: string };
    if (typeof user.id !== 'number') return null;
    return {
      id: user.id,
      username: user.username ?? '',
      name: [user.first_name, user.last_name].filter(Boolean).join(' '),
    };
  } catch {
    return null;
  }
}
