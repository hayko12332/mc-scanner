import { Logger } from '@nestjs/common';
import type pg from 'pg';
import { db } from '../db.js';

// Every company with an MC number and an active USDOT (from the FMCSA census, refreshed weekly) for the public
// company pages (/mc/<number>), the state and city lists and the sitemap. Only what those pages show is kept —
// no phone, email or officer names (those stay behind the lookup tool).

export interface PublicCompany {
  mc: number;
  dot: number;
  name: string;
  dba: string;
  city: string;
  state: string;
  /** FMCSA entity codes: C carrier, B broker, S shipper, F freight forwarder, … (comma separated). */
  kinds: string;
  /** A interstate, B intrastate hazmat, C intrastate non-hazmat. */
  operation: string;
  powerUnits: number | null;
  drivers: number | null;
  cargo: string[];
  addedOn: string | null;
  mcs150On: string | null;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS fmcsa_companies (
    mc           INTEGER PRIMARY KEY,
    dot          INTEGER NOT NULL,
    name         TEXT NOT NULL,
    dba          TEXT NOT NULL DEFAULT '',
    city         TEXT NOT NULL DEFAULT '',
    state        TEXT NOT NULL DEFAULT '',
    city_slug    TEXT NOT NULL DEFAULT '',
    kinds        TEXT NOT NULL DEFAULT '',
    operation    TEXT NOT NULL DEFAULT '',
    power_units  INTEGER,
    drivers      INTEGER,
    cargo        TEXT NOT NULL DEFAULT '',
    added_on     DATE,
    mcs150_on    DATE,
    synced_at    TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS fmcsa_companies_place ON fmcsa_companies (state, city_slug);
  CREATE INDEX IF NOT EXISTS fmcsa_companies_dot ON fmcsa_companies (dot);
  CREATE TABLE IF NOT EXISTS fmcsa_companies_sync (
    id           INTEGER PRIMARY KEY DEFAULT 1,
    finished_at  TIMESTAMPTZ,
    rows         INTEGER NOT NULL DEFAULT 0
  );
`;

/** "SALT LAKE CITY" → "salt-lake-city". */
export const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
/** "SALT LAKE CITY" → "Salt Lake City"; short words like "of" stay lower case. */
export const titleCase = (s: string) => s.toLowerCase().replace(/\b([a-z])([a-z']*)/g, (w, a: string, b: string, i: number) =>
  (i > 0 && /^(of|and|the|de|la)$/.test(w) ? w : a.toUpperCase() + b));

const COLS = 'mc, dot, name, dba, city, state, kinds, operation, power_units, drivers, cargo, added_on, mcs150_on';
const day = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const toCompany = (r: Record<string, unknown>): PublicCompany => ({
  mc: Number(r.mc), dot: Number(r.dot), name: String(r.name), dba: String(r.dba ?? ''), city: String(r.city ?? ''), state: String(r.state ?? ''),
  kinds: String(r.kinds ?? ''), operation: String(r.operation ?? ''),
  powerUnits: r.power_units == null ? null : Number(r.power_units), drivers: r.drivers == null ? null : Number(r.drivers),
  cargo: String(r.cargo ?? '').split('|').filter(Boolean), addedOn: day(r.added_on), mcs150On: day(r.mcs150_on),
});

export class CompaniesStore {
  private readonly logger = new Logger(CompaniesStore.name);
  private ready: Promise<unknown> | null = null;

  private async pool(): Promise<pg.Pool | null> {
    const pool = db();
    if (!pool) return null;
    this.ready ??= pool.query(SCHEMA).catch((e: Error) => { this.logger.warn(`fmcsa_companies: ${e.message}`); this.ready = null; });
    await this.ready;
    return pool;
  }

  async upsert(rows: PublicCompany[]): Promise<void> {
    const pool = await this.pool();
    if (!pool || !rows.length) return;
    const values: unknown[] = [];
    const tuples = rows.map((c, i) => {
      values.push(c.mc, c.dot, c.name, c.dba, c.city, c.state, slug(c.city), c.kinds, c.operation, c.powerUnits, c.drivers, c.cargo.join('|'), c.addedOn, c.mcs150On);
      const b = i * 14;
      return `(${Array.from({ length: 14 }, (_, k) => `$${b + k + 1}`).join(',')}, now())`;
    });
    await pool.query(
      `INSERT INTO fmcsa_companies (mc, dot, name, dba, city, state, city_slug, kinds, operation, power_units, drivers, cargo, added_on, mcs150_on, synced_at)
       VALUES ${tuples.join(',')}
       ON CONFLICT (mc) DO UPDATE SET dot = EXCLUDED.dot, name = EXCLUDED.name, dba = EXCLUDED.dba, city = EXCLUDED.city, state = EXCLUDED.state,
         city_slug = EXCLUDED.city_slug, kinds = EXCLUDED.kinds, operation = EXCLUDED.operation, power_units = EXCLUDED.power_units,
         drivers = EXCLUDED.drivers, cargo = EXCLUDED.cargo, added_on = EXCLUDED.added_on, mcs150_on = EXCLUDED.mcs150_on, synced_at = now()`,
      values);
  }

  /** After a full sync: companies FMCSA no longer lists as active are dropped, and the time is noted. */
  async finish(startedAt: Date, rows: number): Promise<number> {
    const pool = await this.pool();
    if (!pool) return 0;
    const gone = await pool.query('DELETE FROM fmcsa_companies WHERE synced_at < $1', [startedAt]);
    await pool.query(`INSERT INTO fmcsa_companies_sync (id, finished_at, rows) VALUES (1, now(), $1)
      ON CONFLICT (id) DO UPDATE SET finished_at = now(), rows = EXCLUDED.rows`, [rows]);
    return gone.rowCount ?? 0;
  }

  async lastSync(): Promise<{ at: Date | null; rows: number }> {
    const pool = await this.pool();
    if (!pool) return { at: null, rows: 0 };
    const { rows } = await pool.query('SELECT finished_at, rows FROM fmcsa_companies_sync WHERE id = 1');
    return { at: rows[0]?.finished_at ? new Date(rows[0].finished_at) : null, rows: Number(rows[0]?.rows ?? 0) };
  }

  async byMc(mc: number): Promise<PublicCompany | null> {
    const pool = await this.pool();
    if (!pool) return null;
    const { rows } = await pool.query(`SELECT ${COLS} FROM fmcsa_companies WHERE mc = $1`, [mc]);
    return rows[0] ? toCompany(rows[0]) : null;
  }

  /** The MC of a USDOT number (the lowest when it has several). */
  async mcOfDot(dot: number): Promise<number | null> {
    const pool = await this.pool();
    if (!pool) return null;
    const { rows } = await pool.query('SELECT min(mc) AS mc FROM fmcsa_companies WHERE dot = $1', [dot]);
    return rows[0]?.mc == null ? null : Number(rows[0].mc);
  }

  /** Other companies in the same city (largest fleets first). */
  async neighbors(c: PublicCompany, limit = 12): Promise<PublicCompany[]> {
    const pool = await this.pool();
    if (!pool) return [];
    const { rows } = await pool.query(
      `SELECT ${COLS} FROM fmcsa_companies WHERE state = $1 AND city_slug = $2 AND mc <> $3 ORDER BY power_units DESC NULLS LAST, mc LIMIT $4`,
      [c.state, slug(c.city), c.mc, limit]);
    return rows.map(toCompany);
  }

  async states(): Promise<{ state: string; n: number }[]> {
    const pool = await this.pool();
    if (!pool) return [];
    const { rows } = await pool.query(`SELECT state, count(*)::int AS n FROM fmcsa_companies WHERE state ~ '^[A-Z]{2}$' GROUP BY state ORDER BY state`);
    return rows.map((r) => ({ state: String(r.state), n: Number(r.n) }));
  }

  async cities(state: string): Promise<{ city: string; slug: string; n: number }[]> {
    const pool = await this.pool();
    if (!pool) return [];
    const { rows } = await pool.query(
      `SELECT min(city) AS city, city_slug, count(*)::int AS n FROM fmcsa_companies WHERE state = $1 AND city_slug <> '' GROUP BY city_slug ORDER BY n DESC, city_slug`,
      [state]);
    return rows.map((r) => ({ city: String(r.city), slug: String(r.city_slug), n: Number(r.n) }));
  }

  /** Companies in a state (largest fleets first), or in one city of it. */
  async list(state: string, citySlug: string | null, offset: number, limit: number): Promise<{ total: number; rows: PublicCompany[] }> {
    const pool = await this.pool();
    if (!pool) return { total: 0, rows: [] };
    const where = citySlug ? 'state = $1 AND city_slug = $2' : 'state = $1';
    const args: unknown[] = citySlug ? [state, citySlug] : [state];
    const [t, r] = await Promise.all([
      pool.query(`SELECT count(*)::int AS n FROM fmcsa_companies WHERE ${where}`, args),
      pool.query(`SELECT ${COLS} FROM fmcsa_companies WHERE ${where} ORDER BY power_units DESC NULLS LAST, mc OFFSET ${Math.max(0, offset | 0)} LIMIT ${Math.max(1, limit | 0)}`, args),
    ]);
    return { total: Number(t.rows[0]?.n ?? 0), rows: r.rows.map(toCompany) };
  }

  /** MC numbers for one sitemap file (ordered, `size` per file). */
  async sitemapChunk(index: number, size: number): Promise<number[]> {
    const pool = await this.pool();
    if (!pool) return [];
    const { rows } = await pool.query(`SELECT mc FROM fmcsa_companies ORDER BY mc OFFSET $1 LIMIT $2`, [index * size, size]);
    return rows.map((r) => Number(r.mc));
  }

  async count(): Promise<number> {
    const pool = await this.pool();
    if (!pool) return 0;
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM fmcsa_companies');
    return Number(rows[0]?.n ?? 0);
  }

  /** Every state + city with companies, for the sitemap. */
  async allCities(): Promise<{ state: string; slug: string }[]> {
    const pool = await this.pool();
    if (!pool) return [];
    const { rows } = await pool.query(`SELECT DISTINCT state, city_slug FROM fmcsa_companies WHERE state ~ '^[A-Z]{2}$' AND city_slug <> '' ORDER BY state, city_slug`);
    return rows.map((r) => ({ state: String(r.state), slug: String(r.city_slug) }));
  }
}

export const companiesStore = new CompaniesStore();
