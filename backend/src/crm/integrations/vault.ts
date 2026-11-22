import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Partner credentials (ELD API tokens, OAuth refresh tokens) are stored encrypted with AES-256-GCM.
// The key is INTEGRATIONS_KEY: 32 random bytes, base64 (`openssl rand -base64 32`). Without it,
// connecting partners is off — tokens are never stored in plain text.

const keyOf = (raw = process.env.INTEGRATIONS_KEY ?? ''): Buffer | null => {
  const k = Buffer.from(raw.trim(), 'base64');
  return k.length === 32 ? k : null;
};

export const vaultReady = () => keyOf() !== null;

/** "v1.<iv>.<tag>.<data>", all base64url. */
export function seal(secret: string, raw?: string): string {
  const key = keyOf(raw);
  if (!key) throw new Error('INTEGRATIONS_KEY is not set');
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(secret, 'utf8'), c.final()]);
  return ['v1', iv, c.getAuthTag(), data].map((x) => (typeof x === 'string' ? x : x.toString('base64url'))).join('.');
}

export function open(sealed: string, raw?: string): string {
  const key = keyOf(raw);
  if (!key) throw new Error('INTEGRATIONS_KEY is not set');
  const [v, iv, tag, data] = sealed.split('.');
  if (v !== 'v1' || !iv || !tag || data == null) throw new Error('Unreadable credential');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8');
}
