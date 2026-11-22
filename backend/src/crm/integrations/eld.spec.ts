import { describe, expect, it } from 'vitest';
import { EldError, readFleet, unitKey } from './eld.js';
import { open, seal } from './vault.js';

/** A fake ELD API: path (without query) → JSON pages in order. */
function api(routes: Record<string, unknown[]>, seen: { url: string; headers: Record<string, string> }[] = []) {
  return (async (url: string, init: { headers: Record<string, string> }) => {
    seen.push({ url, headers: init.headers });
    const path = new URL(url).pathname;
    const page = routes[path]?.shift();
    if (page === undefined) return new Response('{}', { status: 404 });
    if (typeof page === 'number') return new Response('{}', { status: page });
    return new Response(JSON.stringify(page), { headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
}

describe('Samsara', () => {
  it('reads vehicles, GPS (all pages) and HOS clocks in minutes, with the driver now in the truck', async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const fleet = await readFleet({ provider: 'samsara', region: 'us', token: 'samsara_api_abc' }, api({
      '/fleet/vehicles': [{ data: [{ id: '1', name: 'Truck #101', vin: 'VIN1', staticAssignedDriver: { id: 'd0', name: 'Old Driver' } }, { id: '2', name: '102' }], pagination: { endCursor: '', hasNextPage: false } }],
      '/fleet/vehicles/stats': [
        { data: [{ id: '1', name: 'Truck #101', gps: { time: '2026-11-21T10:00:00Z', latitude: 32.77, longitude: -96.79, headingDegrees: 90, speedMilesPerHour: 61, reverseGeo: { formattedLocation: 'I-20, Dallas, TX' } } }], pagination: { endCursor: 'c2', hasNextPage: true } },
        { data: [{ id: '2', name: '102', gps: { time: '2026-11-21T09:58:00Z', latitude: 33.75, longitude: -84.39, speedMilesPerHour: 0, reverseGeo: { formattedLocation: 'Atlanta, GA' } } }], pagination: { endCursor: '', hasNextPage: false } },
      ],
      '/fleet/hos/clocks': [{ data: [{ driver: { id: 'd1', name: 'Susan Bob' }, currentVehicle: { id: '1' }, currentDutyStatus: { hosStatusType: 'driving' },
        clocks: { drive: { driveRemainingDurationMs: 39_600_000 }, shift: { shiftRemainingDurationMs: 50_400_000 }, cycle: { cycleRemainingDurationMs: 252_000_000 }, break: { timeUntilBreakDurationMs: 1_800_000 } } }], pagination: { hasNextPage: false } }],
    }, seen));
    expect(seen[0].headers.Authorization).toBe('Bearer samsara_api_abc');
    expect(seen.some((s) => s.url.includes('after=c2'))).toBe(true);
    expect(fleet.units).toHaveLength(2);
    expect(fleet.units[0]).toMatchObject({ vehicleId: '1', name: 'Truck #101', lat: 32.77, lon: -96.79, speedMph: 61, address: 'I-20, Dallas, TX', driver: 'Susan Bob' });
    expect(fleet.units[1]).toMatchObject({ vehicleId: '2', address: 'Atlanta, GA' });
    expect(fleet.hos[0]).toEqual({ driverId: 'd1', driver: 'Susan Bob', vehicleId: '1', status: 'driving', driveLeftMin: 660, shiftLeftMin: 840, cycleLeftMin: 4200, breakLeftMin: 30 });
  });

  it('still gives the map when the token has no HOS permission, and explains a rejected token', async () => {
    const fleet = await readFleet({ provider: 'samsara', region: 'eu', token: 't' }, api({
      '/fleet/vehicles': [{ data: [{ id: '1', name: '7' }] }], '/fleet/vehicles/stats': [{ data: [] }], '/fleet/hos/clocks': [403],
    }));
    expect(fleet.units).toHaveLength(1);
    expect(fleet.hos).toEqual([]);
    await expect(readFleet({ provider: 'samsara', region: 'us', token: 'bad' }, api({ '/fleet/vehicles': [401], '/fleet/vehicles/stats': [401], '/fleet/hos/clocks': [401] })))
      .rejects.toMatchObject({ auth: true, message: expect.stringContaining('didn’t accept') });
  });
});

describe('Motive', () => {
  it('reads vehicle locations with the current driver and available time (seconds → minutes)', async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const fleet = await readFleet({ provider: 'motive', region: 'us', token: 'key1' }, api({
      '/v1/vehicle_locations': [{ vehicles: [{ vehicle: { id: 23, number: 'V-1000', vin: null, current_location: { lat: 47.56, lon: -122.27, description: 'Seattle, WA', located_at: '2026-11-21T12:12:07Z', bearing: 90, speed: 65.1 },
        current_driver: { id: 104, first_name: 'Jensen', last_name: 'Effertz' } } }], pagination: { per_page: 100, page_no: 1, total: 1 } }],
      '/v1/available_time': [{ users: [{ user: { id: 104, first_name: 'Jensen', last_name: 'Effertz', duty_status: 'on_duty', available_time: { cycle: 214800, shift: 49200, drive: 39600, break: 27600 } } }], pagination: { total: 1 } }],
    }, seen));
    expect(seen[0].headers['X-API-Key']).toBe('key1');
    expect(seen[0].url).toContain('https://api.gomotive.com/v1/vehicle_locations?vehicle_status=active&per_page=100&page_no=1');
    expect(fleet.units[0]).toMatchObject({ vehicleId: '23', name: 'V-1000', vin: '', lat: 47.56, speedMph: 65.1, address: 'Seattle, WA', driver: 'Jensen Effertz', driverId: '104' });
    expect(fleet.hos[0]).toEqual({ driverId: '104', driver: 'Jensen Effertz', vehicleId: '23', status: 'on_duty', driveLeftMin: 660, shiftLeftMin: 820, cycleLeftMin: 3580, breakLeftMin: 460 });
  });

  it('turns an outage into a plain message, not a token error', async () => {
    const e = await readFleet({ provider: 'motive', region: 'us', token: 'k' }, api({ '/v1/vehicle_locations': [500], '/v1/available_time': [500] })).catch((x: EldError) => x);
    expect(e).toBeInstanceOf(EldError);
    expect((e as EldError).auth).toBe(false);
  });
});

describe('matching ELD vehicles to board trucks', () => {
  it('compares unit numbers, not labels', () => {
    expect(unitKey('Truck #101')).toBe('101');
    expect(unitKey('UNIT 0101')).toBe('101');
    expect(unitKey('101')).toBe('101');
    expect(unitKey('Fleet Truck #1')).toBe('1');
    expect(unitKey('KW-55')).toBe('kw55');
  });
});

describe('vault', () => {
  it('seals and opens a token; a wrong key or a changed byte fails', () => {
    const key = Buffer.alloc(32, 7).toString('base64');
    const s = seal('samsara_api_secret', key);
    expect(s).not.toContain('samsara_api_secret');
    expect(open(s, key)).toBe('samsara_api_secret');
    expect(() => open(s, Buffer.alloc(32, 8).toString('base64'))).toThrow();
    expect(() => open(s.slice(0, -2) + (s.endsWith('A') ? 'B' : 'A') + s.slice(-1), key)).toThrow();
    expect(() => seal('x', 'short')).toThrow('INTEGRATIONS_KEY');
  });
});
