import { Logger } from '@nestjs/common';
import { db } from '../db.js';

// Driving miles between two US places ("Dallas, TX" → "Atlanta, GA"), for loaded miles and deadhead.
// Places are found with OpenStreetMap Nominatim (at most 1 request a second, per its usage policy) and routed with
// the public OSRM server. Every place and route is cached in Postgres, so each lane is looked up only once.
// If routing is down, the straight-line distance × 1.2 is used as an estimate.

const UA = 'LeadHaul/1.0 (https://mc-scanner-6nao.onrender.com)';
const METERS_PER_MILE = 1609.344;
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS geo_places (q TEXT PRIMARY KEY, lat DOUBLE PRECISION, lon DOUBLE PRECISION, found_at TIMESTAMPTZ NOT NULL DEFAULT now());
  CREATE TABLE IF NOT EXISTS geo_routes (key TEXT PRIMARY KEY, miles INTEGER NOT NULL, estimate BOOLEAN NOT NULL DEFAULT false);
`;

type Point = { lat: number; lon: number };
export interface MilesResult { miles: number; estimate: boolean; from: string; to: string }

/** "PERU, IL, 61354" and "Peru IL 61354" are the same place: lower case, single spaces, no punctuation. */
export const placeKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Cached places and routes carry this version: v2 reads "Aurora, CO" as Colorado (v1 sent "aurora co" as free text
// and Nominatim sometimes took "CO" for "county", e.g. Aurora County, SD), so v1 entries are not reused.
const V = 'v2 ';

const STATES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
  DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  AB: 'Alberta', BC: 'British Columbia', MB: 'Manitoba', NB: 'New Brunswick', NS: 'Nova Scotia', ON: 'Ontario', QC: 'Quebec', SK: 'Saskatchewan',
};

/**
 * "Aurora, CO 80010" → structured search {city: Aurora, state: Colorado, postalcode: 80010}; anything else stays free text.
 * Structured search keeps the two-letter state from being read as something else ("CO" as county).
 */
export function placeQuery(s: string): Record<string, string> {
  const m = /^\s*(.+?)[\s,]+([A-Za-z]{2})\.?(?:[\s,]+(\d{5})(?:-\d{4})?)?(?:[\s,]+(?:usa?|united states))?\s*$/i.exec(s.replace(/\s+/g, ' '));
  const state = m && STATES[m[2].toUpperCase()];
  if (!m || !state) return { q: s };
  const city = m[1].replace(/,\s*$/, '').trim();
  return { city, state, ...(m[3] ? { postalcode: m[3] } : {}) };
}

export function straightMiles(a: Point, b: Point): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2;
  return (2 * 3958.8 * Math.asin(Math.sqrt(h)));
}

export class MilesService {
  private readonly logger = new Logger(MilesService.name);
  private ready: Promise<unknown> | null = null;
  private readonly places = new Map<string, Point | null>();
  private readonly routes = new Map<string, MilesResult>();
  /** Nominatim allows one request a second: requests wait for each other here. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly fetcher: typeof fetch = fetch) {}

  private pool() {
    const pool = db();
    if (pool && !this.ready) this.ready = pool.query(SCHEMA).catch((e: Error) => this.logger.warn(`geo cache: ${e.message}`));
    return pool;
  }

  async miles(from: string, to: string): Promise<MilesResult | null> {
    const a = placeKey(from), b = placeKey(to);
    if (!a || !b) return null;
    if (a === b) return { miles: 0, estimate: false, from, to };
    const key = `${V}${a}|${b}`;
    const known = this.routes.get(key) ?? (await this.savedRoute(key, from, to));
    if (known) return known;

    const [p, q] = [await this.place(from), await this.place(to)];
    if (!p || !q) return null;
    let miles = await this.route(p, q);
    const estimate = miles == null;
    if (miles == null) miles = straightMiles(p, q) * 1.2;
    const result = { miles: Math.round(miles), estimate, from, to };
    this.routes.set(key, result);
    if (!estimate) await this.saveRoute(key, result.miles);
    return result;
  }

  private async savedRoute(key: string, from: string, to: string): Promise<MilesResult | null> {
    const pool = this.pool();
    if (!pool) return null;
    try {
      await this.ready;
      const { rows } = await pool.query('SELECT miles FROM geo_routes WHERE key = $1', [key]);
      if (!rows[0]) return null;
      const r = { miles: Number(rows[0].miles), estimate: false, from, to };
      this.routes.set(key, r);
      return r;
    } catch {
      return null;
    }
  }

  private async saveRoute(key: string, miles: number) {
    const pool = this.pool();
    if (!pool) return;
    await this.ready;
    await pool.query('INSERT INTO geo_routes (key, miles) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET miles = EXCLUDED.miles', [key, miles])
      .catch(() => undefined);
  }

  private async place(text: string): Promise<Point | null> {
    const q = V + placeKey(text);
    if (this.places.has(q)) return this.places.get(q)!;
    const pool = this.pool();
    if (pool) {
      try {
        await this.ready;
        const { rows } = await pool.query('SELECT lat, lon FROM geo_places WHERE q = $1', [q]);
        if (rows[0]) {
          const p = rows[0].lat == null ? null : { lat: Number(rows[0].lat), lon: Number(rows[0].lon) };
          this.places.set(q, p);
          return p;
        }
      } catch { /* look it up below */ }
    }
    const p = await this.geocode(text);
    this.places.set(q, p);
    // Places that were not found are remembered too, so a typo doesn't hit Nominatim on every load.
    if (pool) await pool.query('INSERT INTO geo_places (q, lat, lon) VALUES ($1,$2,$3) ON CONFLICT (q) DO NOTHING', [q, p?.lat ?? null, p?.lon ?? null]).catch(() => undefined);
    return p;
  }

  /** City, ST is looked up as that city in that state; if Nominatim has no such city (a typo, a ZIP that moved), as free text. */
  private async geocode(text: string): Promise<Point | null> {
    const query = placeQuery(text);
    const hit = await this.search(query);
    if (hit || 'q' in query) return hit;
    return this.search({ q: `${query.city}, ${query.state}` });
  }

  private search(query: Record<string, string>): Promise<Point | null> {
    const label = Object.values(query).join(', ');
    const run = async (): Promise<Point | null> => {
      const url = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({ ...query, countrycodes: 'us,ca,mx', format: 'json', limit: '1' })}`;
      try {
        const res = await this.fetcher(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const [hit] = (await res.json()) as { lat: string; lon: string }[];
        return hit ? { lat: Number(hit.lat), lon: Number(hit.lon) } : null;
      } catch (e) {
        this.logger.warn(`Could not find "${label}": ${(e as Error).message}`);
        throw e;
      }
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined).then(() => new Promise((r) => setTimeout(r, 1100)));
    return next;
  }

  /** Driving distance in miles, or null when the router can't be reached. */
  private async route(a: Point, b: Point): Promise<number | null> {
    const url = `https://router.project-osrm.org/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=false`;
    try {
      const res = await this.fetcher(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
      if (!res.ok) return null;
      const data = (await res.json()) as { code: string; routes?: { distance: number }[] };
      return data.code === 'Ok' && data.routes?.[0] ? data.routes[0].distance / METERS_PER_MILE : null;
    } catch {
      return null;
    }
  }
}
