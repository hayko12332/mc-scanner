import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyInitData } from './telegram-auth.js';

const TOKEN = '123456:TEST-token';
const NOW = Date.UTC(2026, 10, 7);

function sign(fields: Record<string, string>, token = TOKEN): string {
  const checkString = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret).update(checkString).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

const user = JSON.stringify({ id: 42, first_name: 'Ann', last_name: 'Lee', username: 'annlee' });
const fresh = String(Math.floor(NOW / 1000) - 60);

describe('verifyInitData', () => {
  it('accepts correctly signed data and returns the user', () => {
    const data = sign({ auth_date: fresh, query_id: 'AAH', user });
    expect(verifyInitData(data, TOKEN, NOW)).toEqual({ id: 42, username: 'annlee', name: 'Ann Lee' });
  });

  it('rejects data signed with another bot token', () => {
    expect(verifyInitData(sign({ auth_date: fresh, user }, '999:OTHER'), TOKEN, NOW)).toBeNull();
  });

  it('rejects tampered fields', () => {
    const data = sign({ auth_date: fresh, user }).replace('annlee', 'mallory');
    expect(verifyInitData(data, TOKEN, NOW)).toBeNull();
  });

  it('rejects stale data and garbage', () => {
    const old = String(Math.floor(NOW / 1000) - 8 * 24 * 3600);
    expect(verifyInitData(sign({ auth_date: old, user }), TOKEN, NOW)).toBeNull();
    expect(verifyInitData('hash=zz&user=1', TOKEN, NOW)).toBeNull();
    expect(verifyInitData('', TOKEN, NOW)).toBeNull();
  });
});
