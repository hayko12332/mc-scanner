import { describe, expect, it } from 'vitest';
import { carrierInput, dispatcherInput, importRows, isoDate, loadInput, truckInput } from './crm.input.js';
import { verifyGoogleIdToken } from './google-auth.js';

const tokenInfo = (o: Record<string, string>) =>
  (async () => new Response(JSON.stringify({
    iss: 'https://accounts.google.com', aud: 'client-1', sub: '42', email: 'ann@x.com', email_verified: 'true',
    name: 'Ann', exp: String(Math.floor(Date.now() / 1000) + 600), ...o,
  }))) as unknown as typeof fetch;

describe('Google sign-in', () => {
  it('accepts a token issued for our client id with a verified email', async () => {
    expect(await verifyGoogleIdToken('tok', 'client-1', tokenInfo({}))).toEqual({ sub: '42', email: 'ann@x.com', name: 'Ann', picture: '' });
  });
  it('rejects other audiences, unverified emails, expired tokens and Google errors', async () => {
    expect(await verifyGoogleIdToken('tok', 'client-1', tokenInfo({ aud: 'someone-else' }))).toBeNull();
    expect(await verifyGoogleIdToken('tok', 'client-1', tokenInfo({ email_verified: 'false' }))).toBeNull();
    expect(await verifyGoogleIdToken('tok', 'client-1', tokenInfo({ exp: '1' }))).toBeNull();
    expect(await verifyGoogleIdToken('tok', 'client-1', (async () => new Response('{}', { status: 400 })) as unknown as typeof fetch)).toBeNull();
    expect(await verifyGoogleIdToken('tok', '', tokenInfo({}))).toBeNull();
  });
});

describe('CRM input', () => {
  it('cleans a load', () => {
    const l = loadInput({ date: '2026-11-10', rate: '$3,800', broker: '  Steam Logistics  ', carrierId: 5, dispatcherId: -1, pro: 7 });
    expect(l).toMatchObject({ date: '2026-11-10', rate: 3800, broker: 'Steam Logistics', carrierId: 5, dispatcherId: null, pro: '' });
  });
  it('rejects bad dates and missing names', () => {
    expect(isoDate('2026-02-30')).toBeNull();
    expect(isoDate('11/10/2026')).toBeNull();
    expect(() => loadInput({ date: 'tomorrow' })).toThrow();
    expect(() => carrierInput({ name: ' ' })).toThrow();
    expect(() => dispatcherInput({ name: 'Sergo', percent: 140 })).toThrow();
    expect(() => loadInput({ date: '2026-11-10', status: 'hacked' })).toThrow();
    expect(loadInput({ date: '2026-11-10', status: 'paid' }).status).toBe('paid');
    expect(loadInput({ date: '2026-11-10' }).status).toBe('booked');
    expect(dispatcherInput({ name: 'Sergo', percent: '7.5' })).toEqual({ name: 'Sergo', percent: 7.5 });
  });
  it('validates imports', () => {
    expect(() => importRows({ rows: [] })).toThrow();
    expect(() => importRows({ rows: [{ date: 'x' }] })).toThrow(/Row 1/);
    expect(importRows({ rows: [{ date: '2026-10-20', rate: '2,000', dispatcher: 'Sergo', carrier: 'BEKU' }] })[0])
      .toMatchObject({ rate: 2000, dispatcher: 'Sergo', carrier: 'BEKU' });
  });
  it('keeps miles, accessorials and billing dates of a load', () => {
    const l = loadInput({
      date: '2026-11-10', truckId: 3, loadedMiles: '1,240', emptyMiles: -5, detention: '$150', lumper: 85, tonu: 'abc',
      invoicedOn: '2026-11-12', paidOn: 'soon',
    });
    expect(l).toMatchObject({ truckId: 3, loadedMiles: 1240, emptyMiles: 0, detention: 150, lumper: 85, tonu: 0, invoicedOn: '2026-11-12', paidOn: null });
  });
  it('cleans carrier fees and trucks', () => {
    expect(carrierInput({ name: 'BEKU', feeType: 'flat', fee: '250' })).toMatchObject({ feeType: 'flat', fee: 250 });
    expect(carrierInput({ name: 'BEKU', feeType: 'weird', fee: 8 })).toMatchObject({ feeType: 'percent', fee: 8, factoring: '' });
    expect(() => carrierInput({ name: 'BEKU', feeType: 'percent', fee: 120 })).toThrow();
    expect(truckInput({ unit: ' 101 ', driver: 'Arman', carrierId: 2 })).toEqual({ unit: '101', driver: 'Arman', phone: '', carrierId: 2 });
    expect(() => truckInput({})).toThrow();
  });
});
