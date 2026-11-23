import { describe, expect, it } from 'vitest';
import { matchDoc } from './doc-match.js';
import type { Load } from './crm.types.js';

const load = (id: number, o: Partial<Load>): Load => ({
  id, date: '2026-11-10', carrierId: null, dispatcherId: null, broker: 'TQL', pro: '', origin: '', destination: '', rate: 2000, notes: '',
  status: 'in_transit', truckId: null, loadedMiles: 0, emptyMiles: 0, detention: 0, layover: 0, tonu: 0, other: 0, lumper: 0,
  invoicedOn: null, paidOn: null, brokerMc: '', ...o,
});
const doc = (o: Partial<Parameters<typeof matchDoc>[0]>) => ({
  kind: 'pod' as const, references: [], origin: '', destination: '', pickupDate: '', deliveryDate: '', shipper: '', consignee: '', ...o,
});

describe('matchDoc', () => {
  const loads = [
    load(1, { pro: 'LD-408864', origin: 'Houston, TX', destination: 'Aiken, SC', date: '2026-11-10' }),
    load(2, { pro: '16482877', origin: 'Fishersville, VA', destination: 'Willis, TX', date: '2026-11-12', notes: 'PO 99812 · Walmart DC' }),
    load(3, { pro: '', origin: 'Houston, TX', destination: 'Aiken, SC', date: '2026-11-18' }),
  ];

  it('matches by the load number printed on the document', () => {
    expect(matchDoc(doc({ references: ['BOL 555', 'LD408864'] }), loads).loadId).toBe(1);
  });

  it('matches by a reference kept in the notes', () => {
    expect(matchDoc(doc({ references: ['PO#99812'] }), loads).loadId).toBe(2);
  });

  it('uses lane and pickup date when no number matches', () => {
    const r = matchDoc(doc({ origin: 'HOUSTON, TX', destination: 'Aiken, SC', pickupDate: '2026-11-18' }), loads);
    expect(r.loadId).toBe(3);
  });

  it('asks when two loads fit the lane equally', () => {
    const r = matchDoc(doc({ origin: 'Houston, TX', destination: 'Aiken, SC' }), loads);
    expect(r.loadId).toBeNull();
    expect(r.candidates.map((c) => c.loadId).sort()).toEqual([1, 3]);
  });

  it('finds nothing for an unrelated document', () => {
    const r = matchDoc(doc({ origin: 'Reno, NV', references: ['X1'] }), loads);
    expect(r).toMatchObject({ loadId: null, candidates: [] });
  });
});
