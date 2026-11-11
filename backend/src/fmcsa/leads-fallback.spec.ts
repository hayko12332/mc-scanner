import { afterEach, describe, expect, it, vi } from 'vitest';
import { CarriersService } from './carriers.service.js';
import type { LeadsDay } from './fmcsa.types.js';
import type { SocrataClient } from './socrata.client.js';

const day = (n: number): LeadsDay => ({ date: '2026-11-01', granted: n, carriers: [] });

describe('New MC leads when FMCSA fails', () => {
  afterEach(() => vi.restoreAllMocks());

  it('serves the last good day instead of an error (e.g. HTTP 429)', async () => {
    const service = new CarriersService({} as SocrataClient);
    const fetch = vi.spyOn(service as unknown as { fetchNewOn: (d: string) => Promise<LeadsDay> }, 'fetchNewOn');
    fetch.mockResolvedValueOnce(day(42));
    expect((await service.newOn('2026-11-01')).granted).toBe(42);

    // Seven hours later the cache is stale and FMCSA is rate-limiting us.
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 7 * 3_600_000);
    fetch.mockRejectedValueOnce(new Error('HTTP 429'));
    expect((await service.newOn('2026-11-01')).granted).toBe(42);
  });

  it('still reports the error when there is nothing saved', async () => {
    const service = new CarriersService({} as SocrataClient);
    vi.spyOn(service as unknown as { fetchNewOn: (d: string) => Promise<LeadsDay> }, 'fetchNewOn').mockRejectedValue(new Error('HTTP 429'));
    await expect(service.newOn('2026-10-01')).rejects.toThrow('429');
  });
});
