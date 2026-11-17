import { describe, expect, it, vi } from 'vitest';
import type { CarriersService } from './carriers.service.js';
import { parseLookupQuery } from './lookup.query.js';
import { LookupService } from './lookup.service.js';
import type { SocrataClient } from './socrata.client.js';

vi.mock('../db.js', () => ({ db: () => null }));

const row = { dot_number: '1491240', legal_name: 'WOSS INC', docket1prefix: 'MC', docket1: '555001' };

function service(query: () => Promise<unknown[]>) {
  const socrata = { query: vi.fn(query) } as unknown as SocrataClient;
  const carriers = { authorities: vi.fn(async () => new Map()) } as unknown as CarriersService;
  return { svc: new LookupService(socrata, carriers), socrata };
}

describe('LookupService cache', () => {
  const parsed = parseLookupQuery('1491240', 'auto')!;

  it('asks FMCSA once for a repeated search and for searches made while one is running', async () => {
    let release!: (rows: unknown[]) => void;
    const { svc, socrata } = service(() => new Promise((r) => (release = r)));
    const a = svc.lookup('1491240', parsed);
    const b = svc.lookup(' 1491240 ', parsed);
    await vi.waitFor(() => expect(socrata.query).toHaveBeenCalledTimes(1));
    release([row]);
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.profiles[0].legalName).toBe('WOSS INC');
    expect(rb.query).toBe('1491240');
    await svc.lookup('1491240', parsed);
    expect(socrata.query).toHaveBeenCalledTimes(1);
  });

  it('serves the saved result when FMCSA fails, and asks again when the saved one is too old', async () => {
    let fail = false;
    const { svc, socrata } = service(async () => {
      if (fail) throw new Error('HTTP 429');
      return [row];
    });
    await svc.lookup('1491240', parsed);
    fail = true;
    const r = await svc.lookup('1491240', parsed, { maxAgeMs: 0 });
    expect(socrata.query).toHaveBeenCalledTimes(2);
    expect(r.profiles).toHaveLength(1);
  });

  it('still fails when FMCSA fails and nothing was saved', async () => {
    const { svc } = service(async () => { throw new Error('HTTP 429'); });
    await expect(svc.lookup('1491240', parsed)).rejects.toThrow('429');
  });
});
