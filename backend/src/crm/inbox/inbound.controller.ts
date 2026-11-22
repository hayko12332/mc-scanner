import { Controller, HttpCode, Logger, Post, Req, UnauthorizedException, type RawBodyRequest } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { config } from '../../config.js';
import { InboxService } from './inbox.service.js';
import type { InboundEmail } from './read-email.js';

// Resend receiving: Resend posts `email.received` (metadata only) here; the body and attachments are then fetched from
// the Resend API (docs: resend.com/docs/webhooks/emails/received, /api-reference/emails/retrieve-received-email).
// Requests are signed the Svix way: HMAC-SHA256 of "id.timestamp.body" with the base64 secret after "whsec_".

/** True when the Svix headers prove Resend sent this body (and it isn't older than 5 minutes). */
export function verifySvix(secret: string, headers: { id: string; timestamp: string; signature: string }, body: string, now = Date.now()): boolean {
  if (!secret || !headers.id || !headers.timestamp || !headers.signature) return false;
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > 300) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const want = createHmac('sha256', key).update(`${headers.id}.${headers.timestamp}.${body}`).digest();
  return headers.signature.split(' ').some((part) => {
    const [v, sig] = part.split(',');
    if (v !== 'v1' || !sig) return false;
    const got = Buffer.from(sig, 'base64');
    return got.length === want.length && timingSafeEqual(got, want);
  });
}

const RECEIVING_KEY = () => (process.env.RESEND_RECEIVING_KEY ?? '').trim() || config.resendApiKey;

/** The received email from Resend: body, recipients and attachments (up to 3, up to 10 MB each). */
export async function fetchReceived(id: string, meta: { to?: string[]; cc?: string[]; received_for?: string[] | string; from?: string; subject?: string }, fetcher: typeof fetch = fetch): Promise<InboundEmail> {
  const get = async (path: string) => {
    const r = await fetcher(`https://api.resend.com${path}`, { headers: { Authorization: `Bearer ${RECEIVING_KEY()}` }, signal: AbortSignal.timeout(30_000) });
    if (!r.ok) throw new Error(`Resend ${path.split('/').slice(0, 3).join('/')}: ${r.status}`);
    return (await r.json()) as Record<string, unknown>;
  };
  const e = await get(`/emails/receiving/${encodeURIComponent(id)}`);
  const list = ((await get(`/emails/receiving/${encodeURIComponent(id)}/attachments`).catch(() => ({ data: [] }))).data as Record<string, unknown>[] | undefined) ?? [];
  const attachments: InboundEmail['attachments'] = [];
  for (const a of list.slice(0, 3)) {
    if (!a.download_url || Number(a.size ?? 0) > 10 * 1024 * 1024) continue;
    const r = await fetcher(String(a.download_url), { signal: AbortSignal.timeout(30_000) }).catch(() => null);
    if (!r?.ok) continue;
    const content = Buffer.from(await r.arrayBuffer());
    if (content.length <= 10 * 1024 * 1024) attachments.push({ filename: String(a.filename ?? 'file'), contentType: String(a.content_type ?? ''), content });
  }
  const arr = (v: unknown) => (Array.isArray(v) ? v.map(String) : typeof v === 'string' && v ? [v] : []);
  // Forwarded mail keeps the original "to"; the board's address is in received_for.
  const to = [...new Set([...arr(meta.received_for), ...arr(e.received_for), ...arr(e.to ?? meta.to), ...arr(e.cc ?? meta.cc)])];
  return { from: String(e.from ?? meta.from ?? ''), to, subject: String(e.subject ?? meta.subject ?? ''), text: String(e.text ?? ''), html: String(e.html ?? ''), attachments };
}

@Controller('inbound')
export class InboundController {
  private readonly logger = new Logger(InboundController.name);
  /** Svix delivers at least once: the same event id is handled once. */
  private readonly seen = new Set<string>();

  constructor(private readonly inbox: InboxService) {}

  @Post('resend')
  @HttpCode(200)
  receive(@Req() req: RawBodyRequest<Request>) {
    const body = req.rawBody?.toString('utf8') ?? '';
    const h = (k: string) => String(req.headers[k] ?? '');
    if (!verifySvix(config.resendWebhookSecret, { id: h('svix-id'), timestamp: h('svix-timestamp'), signature: h('svix-signature') }, body)) throw new UnauthorizedException();
    const id = h('svix-id');
    if (this.seen.has(id)) return { ok: true, duplicate: true };
    this.seen.add(id);
    if (this.seen.size > 5000) this.seen.delete(this.seen.values().next().value!);
    let event: { type?: string; data?: Record<string, unknown> };
    try { event = JSON.parse(body); } catch { return { ok: true }; }
    if (event.type !== 'email.received' || !event.data?.email_id) return { ok: true };
    const d = event.data;
    // Answer at once; reading the email (and the AI) happens after.
    void fetchReceived(String(d.email_id), d as Parameters<typeof fetchReceived>[1])
      .then((e) => this.inbox.receive(e))
      .catch((e: Error) => this.logger.warn(`Inbound ${String(d.email_id)}: ${e.message}`));
    return { ok: true };
  }
}
