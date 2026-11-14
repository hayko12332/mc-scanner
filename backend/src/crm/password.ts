import { randomBytes, randomInt, scrypt, timingSafeEqual, createHash } from 'node:crypto';

// Passwords are stored as scrypt hashes (Node's built-in, memory-hard): "scrypt$N$r$p$salt$hash".
const N = 16384, R = 8, P = 1, KEYLEN = 64;

const derive = (password: string, salt: Buffer, n = N, r = R, p = P) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(password.normalize('NFKC'), salt, KEYLEN, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (e, key) => (e ? reject(e) : resolve(key))));

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return ['scrypt', N, R, P, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function checkPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  const parts = (stored ?? '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, 'base64url');
  const key = await derive(password, Buffer.from(salt, 'base64url'), Number(n), Number(r), Number(p));
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Passwords: at least 8 characters, not just digits, not longer than bcrypt-era limits people hit. */
export function passwordProblem(password: string): string | null {
  if (password.length < 8) return 'Use at least 8 characters for the password';
  if (password.length > 200) return 'The password is too long';
  if (/^\d+$/.test(password)) return 'Use letters too, not only digits';
  return null;
}

/** 6-digit one-time code for email verification and password reset. */
export const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');
export const codeHash = (email: string, code: string) => createHash('sha256').update(`${email}:${code}`).digest('hex');

export const normEmail = (s: string) => s.trim().toLowerCase();
export const emailOk = (s: string) => s.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
