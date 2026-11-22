import { describe, expect, it } from 'vitest';
import { fit, inquiry, postingKey, type TruckNow } from './match.js';
import { htmlText, type PostingFields } from './read-email.js';

const P = (x: Partial<PostingFields>): PostingFields => ({
  broker: 'Coyote', contact: 'Jane Doe', email: 'jane@coyote.example', phone: '', origin: 'Dallas, TX', destination: 'Atlanta, GA', pickup_date: '2026-11-24',
  equipment: 'Van', weight_lbs: 40000, rate: 2400, miles: 780, ref: 'CY-1', notes: '', ...x,
});
const PLACES: Record<string, { lat: number; lon: number }> = {
  'Dallas, TX': { lat: 32.78, lon: -96.8 }, 'Atlanta, GA': { lat: 33.75, lon: -84.39 }, 'Fort Worth, TX': { lat: 32.75, lon: -97.33 }, 'Houston, TX': { lat: 29.76, lon: -95.37 },
};
const find = (p: string) => PLACES[p] ?? null;
const truck = (x: Partial<TruckNow>): TruckNow => ({ id: 1, unit: '101', driver: 'Arman', at: null, where: '', busyUntil: null, driveLeftMin: 600, ...x });
const rules = { minRpm: 2.5, maxDeadhead: 150 };

describe('matching a posted load to the fleet', () => {
  it('picks the closest free truck and passes a good load', () => {
    const f = fit(P({}), [truck({ id: 1, at: PLACES['Houston, TX'] }), truck({ id: 2, unit: '102', at: PLACES['Fort Worth, TX'], where: 'I-30, Fort Worth, TX' })], find, rules);
    expect(f.best).toMatchObject({ truckId: 2, unit: '102', from: 'I-30, Fort Worth, TX' });
    expect(f.best!.deadhead).toBeGreaterThan(20);
    expect(f.best!.deadhead).toBeLessThan(50);
    expect(f.rpm).toBe(3.08);
    expect(f).toMatchObject({ ok: true, why: '' });
  });

  it('counts a busy truck from where its load delivers, only if it delivers before the pickup', () => {
    const busy = truck({ at: PLACES['Atlanta, GA'], busyUntil: { place: PLACES['Fort Worth, TX'], name: 'Fort Worth, TX', date: '2026-11-23' } });
    expect(fit(P({}), [busy], find, rules).best?.from).toBe('after delivery in Fort Worth, TX');
    expect(fit(P({ pickup_date: '2026-11-22' }), [busy], find, rules).best).toBeNull();
  });

  it('says why a load does not pass', () => {
    expect(fit(P({ rate: 1500 }), [truck({ at: PLACES['Dallas, TX'] })], find, rules).why).toBe('$1.92/mi is under $2.50');
    expect(fit(P({}), [truck({ at: PLACES['Atlanta, GA'] })], find, rules).why).toMatch(/closest truck is ~\d+ mi away/);
    expect(fit(P({ origin: 'Nowhere, ZZ' }), [truck({ at: PLACES['Dallas, TX'] })], find, rules).why).toBe('pickup place unknown');
    expect(fit(P({}), [truck({})], find, rules).why).toBe('no free truck with a known location');
    // No posted rate: the rate rule can't fail it (the broker is asked for one).
    expect(fit(P({ rate: 0 }), [truck({ at: PLACES['Dallas, TX'] })], find, rules).ok).toBe(true);
  });

  it('keeps one copy of the same load from two alerts', () => {
    expect(postingKey(P({ broker: 'Coyote Logistics', ref: 'CY-1' }))).toBe(postingKey(P({ broker: 'coyote logistics', ref: 'cy 1', rate: 2500 })));
    expect(postingKey(P({ ref: '' }))).not.toBe(postingKey(P({ ref: '', pickup_date: '2026-11-25' })));
  });

  it('writes a short first email with the lane, the truck and the rate question', () => {
    const f = fit(P({}), [truck({ at: PLACES['Fort Worth, TX'] })], find, rules);
    const m = inquiry(P({}), f.best, { name: 'Sevan Dispatch', mc: '123456', phone: '(555) 010-2030' }, 'Ann Smith');
    expect(m.subject).toBe('Dallas, TX → Atlanta, GA on 11/24 · ref CY-1 · truck available');
    expect(m.body).toContain('Hello Jane,');
    expect(m.body).toContain('Is your load Dallas, TX → Atlanta, GA on 11/24 (ref CY-1), Van still available?');
    expect(m.body).toContain('Is $2,400 firm, or is there room?');
    expect(m.body).toMatch(/Ann Smith\nSevan Dispatch\nMC 123456\n\(555\) 010-2030$/);
  });
});

describe('reading HTML alert emails', () => {
  it('keeps table rows and email links', () => {
    const t = htmlText('<table><tr><td>Dallas, TX</td><td>Atlanta, GA</td><td><a href="mailto:jane@coyote.example">Jane</a></td></tr><tr><td>Houston &amp; Co</td></tr></table><style>.x{}</style>');
    expect(t).toBe('Dallas, TX | Atlanta, GA | Jane (jane@coyote.example) |\nHouston & Co |');
  });
});

describe('Resend webhook signature', () => {
  it('accepts Resend’s signature and rejects a changed body, a wrong secret or an old timestamp', async () => {
    const { verifySvix } = await import('./inbound.controller.js');
    const { createHmac } = await import('node:crypto');
    const secret = `whsec_${Buffer.from('0123456789abcdef0123456789abcdef').toString('base64')}`;
    const body = '{"type":"email.received","data":{"email_id":"e1"}}';
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = createHmac('sha256', Buffer.from(secret.slice(6), 'base64')).update(`msg_1.${ts}.${body}`).digest('base64');
    const h = { id: 'msg_1', timestamp: ts, signature: `v1,bogus v1,${sig}` };
    expect(verifySvix(secret, h, body)).toBe(true);
    expect(verifySvix(secret, h, body.replace('e1', 'e2'))).toBe(false);
    expect(verifySvix(`whsec_${Buffer.from('x'.repeat(32)).toString('base64')}`, h, body)).toBe(false);
    expect(verifySvix(secret, { ...h, timestamp: String(Number(ts) - 600) }, body)).toBe(false);
    expect(verifySvix('', h, body)).toBe(false);
  });
});

describe('fetching a received email from Resend', () => {
  it('gets the body and attachments, and finds the board address of forwarded mail in received_for', async () => {
    const { fetchReceived } = await import('./inbound.controller.js');
    const calls: string[] = [];
    const fetcher = (async (url: string) => {
      calls.push(url);
      if (url.endsWith('/emails/receiving/e1')) return Response.json({ from: 'alerts@dat.example', to: ['me@gmail.com'], subject: 'New loads', text: 'Dallas, TX -> Atlanta, GA', html: '<p>x</p>' });
      if (url.endsWith('/emails/receiving/e1/attachments')) return Response.json({ data: [{ id: 'a1', filename: 'rc.pdf', content_type: 'application/pdf', size: 4, download_url: 'https://cdn.example/rc.pdf' }] });
      if (url === 'https://cdn.example/rc.pdf') return new Response('%PDF');
      return new Response('{}', { status: 404 });
    }) as unknown as typeof fetch;
    const e = await fetchReceived('e1', { received_for: ['loads-abc@in.haulpanel.com'] }, fetcher);
    expect(e).toMatchObject({ from: 'alerts@dat.example', subject: 'New loads', text: 'Dallas, TX -> Atlanta, GA', to: ['loads-abc@in.haulpanel.com', 'me@gmail.com'] });
    expect(e.attachments[0]).toMatchObject({ filename: 'rc.pdf', contentType: 'application/pdf' });
    expect(e.attachments[0].content.toString()).toBe('%PDF');
    expect(calls[0]).toBe('https://api.resend.com/emails/receiving/e1');
  });
});
