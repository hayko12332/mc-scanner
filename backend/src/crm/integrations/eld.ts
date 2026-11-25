// ELD connections: Samsara (the carrier's own API token) and Motive (the carrier's API key, once Motive has approved
// HaulPanel as a partner — their API terms §2.3/§3.6 require it). Both are read-only: vehicles, their latest GPS
// point and the drivers' hours-of-service clocks. Field names follow the official docs (developers.samsara.com,
// developer-docs.gomotive.com), checked 2026-11-21.

export type EldProvider = 'samsara' | 'motive';
export const ELD_PROVIDERS: EldProvider[] = ['samsara', 'motive'];
export type EldRegion = 'us' | 'eu' | 'ca';

export interface EldCredential { provider: EldProvider; region: EldRegion; token: string }

/** One vehicle as the ELD sees it right now. */
export interface EldUnit {
  vehicleId: string;
  name: string;
  vin: string;
  lat: number | null;
  lon: number | null;
  /** When the GPS point was taken (ISO). */
  at: string | null;
  speedMph: number | null;
  heading: number | null;
  address: string;
  driverId: string;
  driver: string;
}

/** A driver's hours-of-service clocks, in minutes left. */
export interface EldHos {
  driverId: string;
  driver: string;
  vehicleId: string;
  /** off_duty | sleeper | driving | on_duty | yard_move | personal_conveyance | '' (unknown) */
  status: string;
  driveLeftMin: number | null;
  shiftLeftMin: number | null;
  cycleLeftMin: number | null;
  breakLeftMin: number | null;
}

export class EldError extends Error {
  constructor(message: string, readonly auth = false) { super(message); }
}

const HOSTS: Record<EldProvider, Record<EldRegion, string>> = {
  samsara: { us: 'https://api.samsara.com', eu: 'https://api.eu.samsara.com', ca: 'https://api.ca.samsara.com' },
  motive: { us: 'https://api.gomotive.com', eu: 'https://api.eu.gomotive.com', ca: 'https://api.ca.gomotive.com' },
};

type Fetch = typeof fetch;
type Json = Record<string, unknown>;
const str = (v: unknown) => (v == null ? '' : String(v));
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {});
const minutes = (v: unknown, perMinute: number) => { const n = num(v); return n == null ? null : Math.max(0, Math.round(n / perMinute)); };
const NAME = { samsara: 'Samsara', motive: 'Motive' };

/** Local testing only: point both ELDs at a stand-in server. Ignored on Render. */
const testBase = () => (process.env.RENDER !== 'true' ? (process.env.ELD_TEST_BASE_URL ?? '').replace(/\/+$/, '') : '');

async function get(c: EldCredential, path: string, fetcher: Fetch): Promise<Json> {
  const headers: Record<string, string> = c.provider === 'samsara' ? { Authorization: `Bearer ${c.token}` } : { 'X-API-Key': c.token };
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetcher((testBase() || HOSTS[c.provider][c.region]) + path, { headers: { ...headers, Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
    } catch {
      throw new EldError(`${NAME[c.provider]} isn’t answering right now`);
    }
    if (res.status === 429 && attempt < 2) {
      const wait = Math.min(10, Number(res.headers.get('retry-after')) || 2);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    if (res.status === 401) throw new EldError(`${NAME[c.provider]} didn’t accept this ${c.provider === 'samsara' ? 'API token' : 'API key'} — check it or create a new one`, true);
    if (res.status === 403) throw new EldError(`The ${c.provider === 'samsara' ? 'token' : 'key'} is missing a permission HaulPanel needs (vehicles, vehicle locations and HOS — read only)`, true);
    if (!res.ok) throw new EldError(`${NAME[c.provider]} answered ${res.status}`);
    return obj(await res.json());
  }
}

/** Every page of a list (Samsara: cursor `after`; Motive: `page_no`), capped so one fleet can't run forever. */
async function pages(c: EldCredential, path: string, key: string, fetcher: Fetch, max = 20): Promise<Json[]> {
  const out: Json[] = [];
  const sep = path.includes('?') ? '&' : '?';
  if (c.provider === 'samsara') {
    let after = '';
    for (let i = 0; i < max; i++) {
      const r = await get(c, `${path}${after ? `${sep}after=${encodeURIComponent(after)}` : ''}`, fetcher);
      out.push(...((r[key] as Json[] | undefined) ?? []));
      const p = obj(r.pagination);
      if (!p.hasNextPage || !p.endCursor) break;
      after = str(p.endCursor);
    }
  } else {
    for (let page = 1; page <= max; page++) {
      const r = await get(c, `${path}${sep}per_page=100&page_no=${page}`, fetcher);
      const rows = ((r[key] as Json[] | undefined) ?? []);
      out.push(...rows);
      const total = Number(obj(r.pagination).total ?? 0);
      if (!rows.length || page * 100 >= total) break;
    }
  }
  return out;
}

const SAMSARA_STATUS: Record<string, string> = {
  offDuty: 'off_duty', sleeperBed: 'sleeper', driving: 'driving', onDuty: 'on_duty', yardMove: 'yard_move', personalConveyance: 'personal_conveyance',
};

async function samsara(c: EldCredential, fetcher: Fetch): Promise<{ units: EldUnit[]; hos: EldHos[] }> {
  const [vehicles, gps, clocks] = await Promise.all([
    pages(c, '/fleet/vehicles?limit=512', 'data', fetcher),
    pages(c, '/fleet/vehicles/stats?types=gps', 'data', fetcher),
    // HOS needs "Read ELD Compliance Settings (US)"; a token without it still gives the map.
    pages(c, '/fleet/hos/clocks?limit=512', 'data', fetcher).catch((e: Error) => { if (e instanceof EldError && !e.auth) throw e; return null; }),
  ]);
  const at = new Map(gps.map((g) => [str(g.id), obj(g.gps)]));
  const units = vehicles.map((v): EldUnit => {
    const p = at.get(str(v.id)) ?? {};
    const d = obj(v.staticAssignedDriver);
    return {
      vehicleId: str(v.id), name: str(v.name), vin: str(v.vin),
      lat: num(p.latitude), lon: num(p.longitude), at: str(p.time) || null,
      speedMph: num(p.speedMilesPerHour), heading: num(p.headingDegrees),
      address: str(obj(p.reverseGeo).formattedLocation), driverId: str(d.id), driver: str(d.name),
    };
  });
  // Vehicles the token can't list but that report GPS still show up.
  for (const g of gps) if (!units.some((u) => u.vehicleId === str(g.id))) {
    const p = obj(g.gps);
    units.push({ vehicleId: str(g.id), name: str(g.name), vin: '', lat: num(p.latitude), lon: num(p.longitude), at: str(p.time) || null,
      speedMph: num(p.speedMilesPerHour), heading: num(p.headingDegrees), address: str(obj(p.reverseGeo).formattedLocation), driverId: '', driver: '' });
  }
  const hos = (clocks ?? []).map((h): EldHos => {
    const k = obj(h.clocks);
    return {
      driverId: str(obj(h.driver).id), driver: str(obj(h.driver).name), vehicleId: str(obj(h.currentVehicle).id),
      status: SAMSARA_STATUS[str(obj(h.currentDutyStatus).hosStatusType)] ?? '',
      driveLeftMin: minutes(obj(k.drive).driveRemainingDurationMs, 60_000), shiftLeftMin: minutes(obj(k.shift).shiftRemainingDurationMs, 60_000),
      cycleLeftMin: minutes(obj(k.cycle).cycleRemainingDurationMs, 60_000), breakLeftMin: minutes(obj(k.break).timeUntilBreakDurationMs, 60_000),
    };
  });
  // The driver now in the truck (from HOS) is better than the static assignment.
  for (const h of hos) {
    const u = units.find((x) => x.vehicleId === h.vehicleId);
    if (u && h.driverId) { u.driverId = h.driverId; u.driver = h.driver; }
  }
  return { units, hos };
}

const personName = (u: Json) => [str(u.first_name), str(u.last_name)].filter(Boolean).join(' ');

async function motive(c: EldCredential, fetcher: Fetch): Promise<{ units: EldUnit[]; hos: EldHos[] }> {
  const [locs, avail] = await Promise.all([
    pages(c, '/v1/vehicle_locations?vehicle_status=active', 'vehicles', fetcher),
    pages(c, '/v1/available_time', 'users', fetcher).catch((e: Error) => { if (e instanceof EldError && !e.auth) throw e; return null; }),
  ]);
  const units = locs.map((row): EldUnit => {
    const v = obj(row.vehicle);
    const p = obj(v.current_location);
    const d = obj(v.current_driver);
    return {
      vehicleId: str(v.id), name: str(v.number), vin: str(v.vin),
      lat: num(p.lat), lon: num(p.lon), at: str(p.located_at) || null, speedMph: num(p.speed), heading: num(p.bearing),
      address: str(p.description), driverId: str(d.id), driver: personName(d),
    };
  });
  const hos = (avail ?? []).map((row): EldHos => {
    const u = obj(row.user);
    const k = obj(u.available_time);
    const id = str(u.id);
    return {
      driverId: id, driver: personName(u), vehicleId: units.find((x) => x.driverId === id)?.vehicleId ?? '',
      status: str(u.duty_status),
      driveLeftMin: minutes(k.drive, 60), shiftLeftMin: minutes(k.shift, 60), cycleLeftMin: minutes(k.cycle, 60), breakLeftMin: minutes(k.break, 60),
    };
  });
  return { units, hos };
}

export interface EldPoint { lat: number; lon: number; at: string; speedMph: number | null }

/**
 * Where these vehicles drove between two times, at most one point per 2 minutes per vehicle — so the map has a
 * trail right after a truck is connected. Samsara only (vehicle stats history, the same "vehicle statistics" read
 * permission the map already needs); Motive gets its trail from our own syncs.
 */
export async function readHistory(c: EldCredential, vehicleIds: string[], start: Date, end: Date, fetcher: Fetch = fetch): Promise<Map<string, EldPoint[]>> {
  const out = new Map<string, EldPoint[]>();
  if (c.provider !== 'samsara' || !vehicleIds.length) return out;
  for (let i = 0; i < vehicleIds.length; i += 50) {
    const ids = vehicleIds.slice(i, i + 50);
    const q = new URLSearchParams({ types: 'gps', startTime: start.toISOString(), endTime: end.toISOString(), vehicleIds: ids.join(',') });
    const rows = await pages(c, `/fleet/vehicles/stats/history?${q}`, 'data', fetcher, 30);
    for (const r of rows) {
      const id = str(r.id);
      const list = out.get(id) ?? [];
      let last = list.length ? Date.parse(list[list.length - 1].at) : 0;
      for (const g of ((r.gps as Json[] | undefined) ?? [])) {
        const lat = num(g.latitude), lon = num(g.longitude), t = Date.parse(str(g.time));
        if (lat == null || lon == null || !Number.isFinite(t) || t - last < 120_000) continue;
        // A parked truck needs a point every 30 minutes, not every 2.
        const prev = list[list.length - 1];
        if (prev && t - last < 30 * 60_000 && Math.abs(prev.lat - lat) < 0.0007 && Math.abs(prev.lon - lon) < 0.0007) continue;
        list.push({ lat, lon, at: new Date(t).toISOString(), speedMph: num(g.speedMilesPerHour) });
        last = t;
      }
      out.set(id, list);
    }
  }
  return out;
}

/** The fleet as the ELD sees it now. Throws EldError (auth=true when the token itself is the problem). */
export function readFleet(c: EldCredential, fetcher: Fetch = fetch) {
  return c.provider === 'samsara' ? samsara(c, fetcher) : motive(c, fetcher);
}

/** "Truck #101", "UNIT 0101", "101" → "101": how an ELD vehicle is matched to a board truck by its number. */
export function unitKey(s: string): string {
  const k = s.toLowerCase().replace(/\b(fleet|truck|tractor|unit|trk|veh(icle)?|no)\b/g, '').replace(/[^a-z0-9]/g, '');
  return k.replace(/^0+(?=\d)/, '');
}
