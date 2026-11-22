import { describe, expect, it, vi } from 'vitest';
import type { Mail } from '../mail/mailer.js';

const sent: Mail[] = [];
vi.mock('../mail/mailer.js', () => ({ sendMail: async (m: Mail) => { sent.push(m); } }));
const { sendToFactoring } = await import('./invoice-send.js');
import type { CrmStore } from './crm.store.js';

describe('Send to factoring', () => {
  it('emails one PDF packet to the factor with remit-to and the load facts, marks it invoiced, no broker reminders', async () => {
    const invoiced: unknown[][] = [];
    const store = {
      state: async () => ({
        company: { name: 'Acme Dispatch', mc: '', phone: '' },
        loads: [{ id: 7, date: '2026-11-10', carrierId: 1, dispatcherId: null, broker: 'TQL', pro: 'T-77', origin: 'Dallas, TX', destination: 'Atlanta, GA', rate: 2400, notes: '', status: 'delivered', truckId: null, loadedMiles: 780, emptyMiles: 0, detention: 100, layover: 0, tonu: 0, other: 0, lumper: 0, invoicedOn: null, paidOn: null, brokerMc: '411443' }],
        carriers: [{ id: 1, name: 'BEKU Trucking', mc: 'MC 1234567', dot: '', phone: '', email: 'ops@beku.com', notes: '', feeType: 'percent', fee: 8, factoring: 'RTS Financial', factoringEmail: 'invoices@rts.example' }],
        trucks: [], brokerEmails: {},
      }),
      filesOf: async () => [],
      invoiceSent: async (...a: unknown[]) => { invoiced.push(a); },
    } as unknown as CrmStore;
    const r = await sendToFactoring(store, 1, { id: 1, email: 'me@acme.com', name: 'Ann', picture: '' }, 7, 'invoices@rts.example', ['ops@beku.com'], [], '');
    expect(r).toEqual({ number: 'INV-00007', to: 'invoices@rts.example' });
    const m = sent[0];
    expect(m.to).toBe('invoices@rts.example');
    expect(m.cc).toEqual(['ops@beku.com']);
    expect(m.replyTo).toBe('me@acme.com');
    expect(m.subject).toBe('Invoice for factoring · BEKU Trucking MC 1234567 · Load T-77 · TQL · $2,500.00');
    expect(m.text).toContain('Broker (debtor): TQL · MC 411443');
    expect(m.attachments?.[0].filename).toBe('Invoice-INV-00007-T-77.pdf');
    expect(Buffer.from(m.attachments![0].content as Uint8Array).subarray(0, 4).toString()).toBe('%PDF');
    expect(invoiced[0][4]).toBe(false); // the factor collects: no reminders to the broker
  });
});
