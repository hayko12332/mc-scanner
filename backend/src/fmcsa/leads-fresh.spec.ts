import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAuthority, summarizeMotus } from './authority.mapper.js';
import { CarriersService, easternDay, looksIncomplete } from './carriers.service.js';
import type { LeadKind, LeadsDay } from './fmcsa.types.js';
import type { SocrataClient } from './socrata.client.js';

const day = (date: string, n: number): LeadsDay => ({ date, granted: n, carriers: [] });
type Fetch = (d: string, k: LeadKind) => Promise<LeadsDay>;

function setup(updatedAt: () => number | null) {
  const socrata = { updatedAt: vi.fn(async () => updatedAt()) } as unknown as SocrataClient;
  const service = new CarriersService(socrata);
  const fetch = vi.spyOn(service as unknown as { fetchNewOn: Fetch }, 'fetchNewOn');
  return { service, fetch };
}

describe('New leads stay fresh and fast', () => {
  afterEach(() => vi.restoreAllMocks());

  it('answers from memory until FMCSA publishes new data, then fetches again', async () => {
    let version = Date.now() - 3_600_000;
    const { service, fetch } = setup(() => version);
    const today = easternDay(0);
    fetch.mockResolvedValueOnce(day(today, 12));
    expect((await service.newOn(today)).granted).toBe(12);
    expect((await service.newOn(today)).granted).toBe(12);
    expect(fetch).toHaveBeenCalledTimes(1);

    // FMCSA's daily update lands (the version is re-checked every 5 minutes).
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 6 * 60_000);
    version = now + 60_000;
    fetch.mockResolvedValueOnce(day(today, 180));
    expect((await service.newOn(today)).granted).toBe(180);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps carriers and brokers apart', async () => {
    const { service, fetch } = setup(() => Date.now() - 60_000);
    const today = easternDay(0);
    fetch.mockImplementation(async (d, k) => day(d, k === 'broker' ? 7 : 150));
    expect((await service.newOn(today, 'broker')).granted).toBe(7);
    expect((await service.newOn(today, 'carrier')).granted).toBe(150);
    expect(fetch.mock.calls.map((c) => c[1])).toEqual(['broker', 'carrier']);
  });

  it('asks FMCSA once when many visitors open the same day at the same time', async () => {
    const { service, fetch } = setup(() => Date.now() - 60_000);
    fetch.mockImplementation(async (d) => day(d, 5));
    const today = easternDay(0);
    await Promise.all([service.newOn(today), service.newOn(today), service.newOn(today)]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('FMCSA files that update minutes apart', () => {
  afterEach(() => vi.restoreAllMocks());

  it('fetches a day again when a later file (registrations) lands after the authority history', async () => {
    const t0 = Date.now();
    const times: Record<string, number> = { 'yu5v-wbh6': t0 - 60_000, 'inys-ebih': t0 - 120_000, 'az4n-8mr2': t0 - 86_400_000 };
    const socrata = { updatedAt: vi.fn(async (id: string) => times[id]) } as unknown as SocrataClient;
    const service = new CarriersService(socrata);
    const fetch = vi.spyOn(service as unknown as { fetchNewOn: Fetch }, 'fetchNewOn');
    const today = easternDay(0);
    fetch.mockResolvedValueOnce({ date: today, granted: 136, carriers: Array.from({ length: 130 }, () => ({}) as never) });
    expect((await service.newOn(today)).carriers.length).toBe(130);

    // Six minutes later the registration file updates too: the day is fetched once more.
    vi.spyOn(Date, 'now').mockReturnValue(t0 + 6 * 60_000);
    times['inys-ebih'] = t0 + 5 * 60_000;
    fetch.mockResolvedValueOnce({ date: today, granted: 136, carriers: Array.from({ length: 134 }, () => ({}) as never) });
    expect((await service.newOn(today)).carriers.length).toBe(134);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('tries a day again in 10 minutes when most grants did not match yet', async () => {
    const { service, fetch } = setup(() => Date.now() - 3_600_000);
    const today = easternDay(0);
    fetch.mockResolvedValueOnce({ date: today, granted: 136, carriers: Array.from({ length: 13 }, () => ({}) as never) });
    expect((await service.newOn(today)).carriers.length).toBe(13);
    expect((await service.newOn(today)).carriers.length).toBe(13); // within 10 minutes: no new fetch
    expect(fetch).toHaveBeenCalledTimes(1);
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 11 * 60_000);
    fetch.mockResolvedValueOnce({ date: today, granted: 136, carriers: Array.from({ length: 133 }, () => ({}) as never) });
    expect((await service.newOn(today)).carriers.length).toBe(133);
  });
});

describe('Broker authority', () => {
  const motus = summarizeMotus([
    { docket_number: 'MC51974960', op_auth_type: 'Broker of Property (Except Household Goods)', op_auth_status: 'Active', bond_req: 'Y', bond_file: 'Y' },
  ]);
  it('keeps an active broker for broker leads but not for carrier leads', () => {
    const m = motus.get(51974960);
    expect(buildAuthority(undefined, m, 'strict', 'broker')).toMatchObject({ broker: 'A', common: 'N', bondOnFile: 'Y' });
    expect(buildAuthority(undefined, m, 'strict', 'carrier')).toBeNull();
  });
});

describe('Incomplete days', () => {
  it('flags a day where most grants found no company', () => {
    expect(looksIncomplete({ date: 'x', granted: 136, carriers: Array(13) })).toBe(true);
    expect(looksIncomplete({ date: 'x', granted: 236, carriers: Array(231) })).toBe(false);
    expect(looksIncomplete({ date: 'x', granted: 5, carriers: [] })).toBe(false);
  });
});
