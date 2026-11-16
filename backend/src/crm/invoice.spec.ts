import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { invoiceData } from './crm.controller.js';
import type { Load } from './crm.types.js';
import { buildInvoicePdf, invoiceTotal } from './invoice.js';

const load: Load = {
  id: 42, date: '2026-11-10', carrierId: 1, dispatcherId: null, broker: 'Total Quality Logistics', pro: 'TQL-9921045',
  origin: 'Nashville, TN', destination: 'Orlando, FL', rate: 2100, notes: '', status: 'delivered', truckId: null, loadedMiles: 686, emptyMiles: 0,
  detention: 150, layover: 0, tonu: 0, other: 0, lumper: 80, invoicedOn: null, paidOn: null, brokerMc: '411443',
};

describe('Load invoice', () => {
  it('bills the rate and accessorials (lumper as a reimbursement), net 30 from today', () => {
    const d = invoiceData(load, { from: { name: 'BEKU Trucking', mc: '1234567' }, remitTo: 'RTS Financial' }, new Date('2026-11-16T15:00:00Z'));
    expect(d.number).toBe('INV-00042');
    expect(d.date).toBe('2026-11-16');
    expect(d.due).toBe('2026-12-16');
    expect(d.lines.map((l) => l.label)).toEqual(['Linehaul', 'Detention', 'Lumper (reimbursement, receipt attached)']);
    expect(invoiceTotal(d)).toBe(2330);
    expect(d.billTo).toMatchObject({ name: 'Total Quality Logistics', mc: '411443' });
  });

  it('builds one PDF: the invoice page, then the attached documents', async () => {
    const pod = await PDFDocument.create();
    pod.addPage(); pod.addPage();
    const d = invoiceData({ ...load, origin: 'Nashville, TN → Ünïcode ✓' }, { from: { name: 'BEKU Trucking' } });
    const bytes = await buildInvoicePdf(d, [
      { name: 'POD.pdf', mime: 'application/pdf', data: await pod.save() },
      { name: 'broken.pdf', mime: 'application/pdf', data: new Uint8Array([1, 2, 3]) },
    ]);
    const out = await PDFDocument.load(bytes);
    expect(out.getPageCount()).toBe(3);
    expect(out.getTitle()).toBe('Invoice INV-00042');
  });
});

describe('Board data for the AI assistant', () => {
  it('is one line per load with names instead of ids', async () => {
    const { boardText } = await import('./crm.controller.js');
    const t = boardText({
      company: { name: 'Acme Dispatch' }, loads: [load],
      carriers: [{ id: 1, name: 'BEKU Trucking', mc: '123', feeType: 'percent', fee: 8, factoring: 'RTS' }],
      trucks: [], dispatchers: [],
    });
    expect(t).toContain('42|2026-11-10|delivered|Total Quality Logistics|TQL-9921045|Nashville, TN|Orlando, FL|2100|150|0|0|0|80|686|0|BEKU Trucking|||');
    expect(t).toContain('BEKU Trucking (MC 123, fee 8%, factoring RTS)');
  });
});
