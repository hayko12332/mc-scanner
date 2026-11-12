import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import type { CrmCarrier, CrmState, CrmUser, Dispatcher, FeeType, ImportRow, Load, LoadStatus, Truck } from './crm.types.js';

const SESSION_DAYS = 60;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS crm_users (
    id          BIGSERIAL PRIMARY KEY,
    google_sub  TEXT UNIQUE NOT NULL,
    email       TEXT NOT NULL DEFAULT '',
    name        TEXT NOT NULL DEFAULT '',
    picture     TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS crm_sessions (
    token_hash  TEXT PRIMARY KEY,
    user_id     BIGINT NOT NULL REFERENCES crm_users(id) ON DELETE CASCADE,
    expires_at  TIMESTAMPTZ NOT NULL
  );
  -- One workspace per user for now; teams will add more members to a workspace.
  CREATE TABLE IF NOT EXISTS crm_workspaces (
    id          BIGSERIAL PRIMARY KEY,
    owner_id    BIGINT UNIQUE NOT NULL REFERENCES crm_users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS crm_dispatchers (
    id            BIGSERIAL PRIMARY KEY,
    workspace_id  BIGINT NOT NULL REFERENCES crm_workspaces(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    percent       NUMERIC(5,2) NOT NULL DEFAULT 0,
    archived      BOOLEAN NOT NULL DEFAULT false
  );
  CREATE TABLE IF NOT EXISTS crm_carriers (
    id            BIGSERIAL PRIMARY KEY,
    workspace_id  BIGINT NOT NULL REFERENCES crm_workspaces(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    mc            TEXT NOT NULL DEFAULT '',
    dot           TEXT NOT NULL DEFAULT '',
    phone         TEXT NOT NULL DEFAULT '',
    email         TEXT NOT NULL DEFAULT '',
    notes         TEXT NOT NULL DEFAULT '',
    archived      BOOLEAN NOT NULL DEFAULT false
  );
  CREATE TABLE IF NOT EXISTS crm_loads (
    id             BIGSERIAL PRIMARY KEY,
    workspace_id   BIGINT NOT NULL REFERENCES crm_workspaces(id) ON DELETE CASCADE,
    load_date      DATE NOT NULL,
    carrier_id     BIGINT REFERENCES crm_carriers(id) ON DELETE SET NULL,
    dispatcher_id  BIGINT REFERENCES crm_dispatchers(id) ON DELETE SET NULL,
    broker         TEXT NOT NULL DEFAULT '',
    pro            TEXT NOT NULL DEFAULT '',
    origin         TEXT NOT NULL DEFAULT '',
    destination    TEXT NOT NULL DEFAULT '',
    rate           NUMERIC(12,2) NOT NULL DEFAULT 0,
    notes          TEXT NOT NULL DEFAULT '',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS crm_loads_ws_date ON crm_loads (workspace_id, load_date);
  ALTER TABLE crm_loads ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'booked';
  -- Carrier billing: the dispatch fee (percent of gross or flat per week) and their factoring company
  ALTER TABLE crm_carriers ADD COLUMN IF NOT EXISTS fee_type TEXT NOT NULL DEFAULT 'percent';
  ALTER TABLE crm_carriers ADD COLUMN IF NOT EXISTS fee NUMERIC(12,2) NOT NULL DEFAULT 0;
  ALTER TABLE crm_carriers ADD COLUMN IF NOT EXISTS factoring TEXT NOT NULL DEFAULT '';
  CREATE TABLE IF NOT EXISTS crm_trucks (
    id            BIGSERIAL PRIMARY KEY,
    workspace_id  BIGINT NOT NULL REFERENCES crm_workspaces(id) ON DELETE CASCADE,
    carrier_id    BIGINT REFERENCES crm_carriers(id) ON DELETE SET NULL,
    unit          TEXT NOT NULL DEFAULT '',
    driver        TEXT NOT NULL DEFAULT '',
    phone         TEXT NOT NULL DEFAULT '',
    archived      BOOLEAN NOT NULL DEFAULT false
  );
  -- Loads: truck, miles, accessorials, invoice and payment dates
  ALTER TABLE crm_loads ADD COLUMN IF NOT EXISTS truck_id BIGINT REFERENCES crm_trucks(id) ON DELETE SET NULL;
  ALTER TABLE crm_loads ADD COLUMN IF NOT EXISTS loaded_miles INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE crm_loads ADD COLUMN IF NOT EXISTS empty_miles INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE crm_loads ADD COLUMN IF NOT EXISTS detention NUMERIC(12,2) NOT NULL DEFAULT 0;
  ALTER TABLE crm_loads ADD COLUMN IF NOT EXISTS layover NUMERIC(12,2) NOT NULL DEFAULT 0;
  ALTER TABLE crm_loads ADD COLUMN IF NOT EXISTS tonu NUMERIC(12,2) NOT NULL DEFAULT 0;
  ALTER TABLE crm_loads ADD COLUMN IF NOT EXISTS other NUMERIC(12,2) NOT NULL DEFAULT 0;
  ALTER TABLE crm_loads ADD COLUMN IF NOT EXISTS lumper NUMERIC(12,2) NOT NULL DEFAULT 0;
  ALTER TABLE crm_loads ADD COLUMN IF NOT EXISTS invoiced_on DATE;
  ALTER TABLE crm_loads ADD COLUMN IF NOT EXISTS paid_on DATE;
`;

const CARRIER_COLS = 'id, name, mc, dot, phone, email, notes, fee_type, fee, factoring';
const TRUCK_COLS = 'id, carrier_id, unit, driver, phone';
const LOAD_COLS = `id, to_char(load_date, 'YYYY-MM-DD') AS load_date, carrier_id, dispatcher_id, broker, pro, origin, destination, rate, notes,
  status, truck_id, loaded_miles, empty_miles, detention, layover, tonu, other, lumper,
  to_char(invoiced_on, 'YYYY-MM-DD') AS invoiced_on, to_char(paid_on, 'YYYY-MM-DD') AS paid_on`;
/** Load columns written by insert/update, in the order of loadValues(). */
const LOAD_WRITE = ['load_date', 'carrier_id', 'dispatcher_id', 'broker', 'pro', 'origin', 'destination', 'rate', 'notes', 'status',
  'truck_id', 'loaded_miles', 'empty_miles', 'detention', 'layover', 'tonu', 'other', 'lumper', 'invoiced_on', 'paid_on'];
const loadValues = (l: LoadInput) => [l.date, l.carrierId, l.dispatcherId, l.broker, l.pro, l.origin, l.destination, l.rate, l.notes, l.status,
  l.truckId, l.loadedMiles, l.emptyMiles, l.detention, l.layover, l.tonu, l.other, l.lumper, l.invoicedOn, l.paidOn];

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

const toDispatcher = (r: Record<string, unknown>): Dispatcher => ({ id: Number(r.id), name: String(r.name), percent: Number(r.percent) });
const toCarrier = (r: Record<string, unknown>): CrmCarrier => ({
  id: Number(r.id), name: String(r.name), mc: String(r.mc), dot: String(r.dot), phone: String(r.phone), email: String(r.email), notes: String(r.notes),
  feeType: (r.fee_type === 'flat' ? 'flat' : 'percent') as FeeType, fee: Number(r.fee ?? 0), factoring: String(r.factoring ?? ''),
});
const toTruck = (r: Record<string, unknown>): Truck => ({
  id: Number(r.id), carrierId: r.carrier_id == null ? null : Number(r.carrier_id), unit: String(r.unit), driver: String(r.driver), phone: String(r.phone),
});
const day = (v: unknown) => (v == null ? null : String(v).slice(0, 10));
const toLoad = (r: Record<string, unknown>): Load => ({
  id: Number(r.id),
  date: r.load_date instanceof Date ? r.load_date.toISOString().slice(0, 10) : String(r.load_date).slice(0, 10),
  carrierId: r.carrier_id == null ? null : Number(r.carrier_id),
  dispatcherId: r.dispatcher_id == null ? null : Number(r.dispatcher_id),
  broker: String(r.broker), pro: String(r.pro), origin: String(r.origin), destination: String(r.destination),
  rate: Number(r.rate), notes: String(r.notes), status: String(r.status) as LoadStatus,
  truckId: r.truck_id == null ? null : Number(r.truck_id),
  loadedMiles: Number(r.loaded_miles ?? 0), emptyMiles: Number(r.empty_miles ?? 0),
  detention: Number(r.detention ?? 0), layover: Number(r.layover ?? 0), tonu: Number(r.tonu ?? 0), other: Number(r.other ?? 0), lumper: Number(r.lumper ?? 0),
  invoicedOn: day(r.invoiced_on), paidOn: day(r.paid_on),
});

export type LoadInput = Omit<Load, 'id'>;
export type CarrierInput = Omit<CrmCarrier, 'id'>;
export type TruckInput = Omit<Truck, 'id'>;

/** Every query is scoped to one workspace, so a user can only ever touch their own rows. */
export class CrmStore {
  private readonly ready: Promise<unknown>;

  constructor(private readonly pool: pg.Pool) {
    this.ready = pool.query(SCHEMA);
  }

  /** Creates the user and their workspace on first sign-in; returns the user. */
  async signIn(p: { sub: string; email: string; name: string; picture: string }): Promise<CrmUser> {
    await this.ready;
    const { rows } = await this.pool.query(
      `INSERT INTO crm_users (google_sub, email, name, picture) VALUES ($1,$2,$3,$4)
       ON CONFLICT (google_sub) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name, picture = EXCLUDED.picture
       RETURNING id, email, name, picture`,
      [p.sub, p.email, p.name, p.picture],
    );
    const user = { id: Number(rows[0].id), email: rows[0].email, name: rows[0].name, picture: rows[0].picture };
    await this.pool.query('INSERT INTO crm_workspaces (owner_id) VALUES ($1) ON CONFLICT (owner_id) DO NOTHING', [user.id]);
    return user;
  }

  async createSession(userId: number): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.pool.query(
      `INSERT INTO crm_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '${SESSION_DAYS} days')`,
      [hash(token), userId],
    );
    return token;
  }

  /** The signed-in user and their workspace for a session cookie, or null. */
  async session(token: string): Promise<{ user: CrmUser; workspaceId: number } | null> {
    if (!token) return null;
    await this.ready;
    const { rows } = await this.pool.query(
      `SELECT u.id, u.email, u.name, u.picture, w.id AS workspace_id
         FROM crm_sessions s JOIN crm_users u ON u.id = s.user_id JOIN crm_workspaces w ON w.owner_id = u.id
        WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [hash(token)],
    );
    const r = rows[0];
    return r ? { user: { id: Number(r.id), email: r.email, name: r.name, picture: r.picture }, workspaceId: Number(r.workspace_id) } : null;
  }

  async endSession(token: string) {
    await this.pool.query('DELETE FROM crm_sessions WHERE token_hash = $1', [hash(token)]);
  }

  async state(ws: number, user: CrmUser): Promise<CrmState> {
    await this.ready;
    const [d, c, t, l] = await Promise.all([
      this.pool.query('SELECT id, name, percent FROM crm_dispatchers WHERE workspace_id = $1 AND NOT archived ORDER BY name', [ws]),
      this.pool.query(`SELECT ${CARRIER_COLS} FROM crm_carriers WHERE workspace_id = $1 AND NOT archived ORDER BY name`, [ws]),
      this.pool.query(`SELECT ${TRUCK_COLS} FROM crm_trucks WHERE workspace_id = $1 AND NOT archived ORDER BY unit, driver`, [ws]),
      this.pool.query(`SELECT ${LOAD_COLS} FROM crm_loads WHERE workspace_id = $1 ORDER BY load_date DESC, id DESC`, [ws]),
    ]);
    return { user, dispatchers: d.rows.map(toDispatcher), carriers: c.rows.map(toCarrier), trucks: t.rows.map(toTruck), loads: l.rows.map(toLoad) };
  }

  // Dispatchers

  async addDispatcher(ws: number, name: string, percent: number): Promise<Dispatcher> {
    const { rows } = await this.pool.query(
      'INSERT INTO crm_dispatchers (workspace_id, name, percent) VALUES ($1,$2,$3) RETURNING id, name, percent', [ws, name, percent]);
    return toDispatcher(rows[0]);
  }

  async updateDispatcher(ws: number, id: number, name: string, percent: number): Promise<Dispatcher | null> {
    const { rows } = await this.pool.query(
      'UPDATE crm_dispatchers SET name = $3, percent = $4 WHERE workspace_id = $1 AND id = $2 RETURNING id, name, percent', [ws, id, name, percent]);
    return rows[0] ? toDispatcher(rows[0]) : null;
  }

  /** Hidden from lists; their past loads keep pointing at them. */
  async archiveDispatcher(ws: number, id: number) {
    await this.pool.query('UPDATE crm_dispatchers SET archived = true WHERE workspace_id = $1 AND id = $2', [ws, id]);
  }

  // Carriers

  async addCarrier(ws: number, c: CarrierInput): Promise<CrmCarrier> {
    const { rows } = await this.pool.query(
      `INSERT INTO crm_carriers (workspace_id, name, mc, dot, phone, email, notes, fee_type, fee, factoring) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING ${CARRIER_COLS}`,
      [ws, c.name, c.mc, c.dot, c.phone, c.email, c.notes, c.feeType, c.fee, c.factoring],
    );
    return toCarrier(rows[0]);
  }

  async updateCarrier(ws: number, id: number, c: CarrierInput): Promise<CrmCarrier | null> {
    const { rows } = await this.pool.query(
      `UPDATE crm_carriers SET name = $3, mc = $4, dot = $5, phone = $6, email = $7, notes = $8, fee_type = $9, fee = $10, factoring = $11
        WHERE workspace_id = $1 AND id = $2 RETURNING ${CARRIER_COLS}`,
      [ws, id, c.name, c.mc, c.dot, c.phone, c.email, c.notes, c.feeType, c.fee, c.factoring],
    );
    return rows[0] ? toCarrier(rows[0]) : null;
  }

  async archiveCarrier(ws: number, id: number) {
    await this.pool.query('UPDATE crm_carriers SET archived = true WHERE workspace_id = $1 AND id = $2', [ws, id]);
  }

  // Trucks

  private async ownCarrier(ws: number, carrierId: number | null) {
    if (carrierId == null) return null;
    const { rows } = await this.pool.query('SELECT id FROM crm_carriers WHERE workspace_id = $1 AND id = $2', [ws, carrierId]);
    return rows[0] ? Number(rows[0].id) : null;
  }

  async addTruck(ws: number, t: TruckInput): Promise<Truck> {
    const { rows } = await this.pool.query(
      `INSERT INTO crm_trucks (workspace_id, carrier_id, unit, driver, phone) VALUES ($1,$2,$3,$4,$5) RETURNING ${TRUCK_COLS}`,
      [ws, await this.ownCarrier(ws, t.carrierId), t.unit, t.driver, t.phone],
    );
    return toTruck(rows[0]);
  }

  async updateTruck(ws: number, id: number, t: TruckInput): Promise<Truck | null> {
    const { rows } = await this.pool.query(
      `UPDATE crm_trucks SET carrier_id = $3, unit = $4, driver = $5, phone = $6 WHERE workspace_id = $1 AND id = $2 RETURNING ${TRUCK_COLS}`,
      [ws, id, await this.ownCarrier(ws, t.carrierId), t.unit, t.driver, t.phone],
    );
    return rows[0] ? toTruck(rows[0]) : null;
  }

  async archiveTruck(ws: number, id: number) {
    await this.pool.query('UPDATE crm_trucks SET archived = true WHERE workspace_id = $1 AND id = $2', [ws, id]);
  }

  // Loads

  /** Carrier, dispatcher and truck ids must belong to the workspace; anything else is dropped to null. */
  private async owned(ws: number, l: LoadInput): Promise<LoadInput> {
    const { rows } = await this.pool.query(
      `SELECT (SELECT id FROM crm_carriers WHERE workspace_id = $1 AND id = $2) AS carrier,
              (SELECT id FROM crm_dispatchers WHERE workspace_id = $1 AND id = $3) AS dispatcher,
              (SELECT id FROM crm_trucks WHERE workspace_id = $1 AND id = $4) AS truck`,
      [ws, l.carrierId, l.dispatcherId, l.truckId],
    );
    const n = (v: unknown) => (v == null ? null : Number(v));
    return { ...l, carrierId: n(rows[0].carrier), dispatcherId: n(rows[0].dispatcher), truckId: n(rows[0].truck) };
  }

  async addLoad(ws: number, input: LoadInput): Promise<Load> {
    const l = await this.owned(ws, input);
    const { rows } = await this.pool.query(
      `INSERT INTO crm_loads (workspace_id, ${LOAD_WRITE.join(', ')})
       VALUES ($1, ${LOAD_WRITE.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING ${LOAD_COLS}`,
      [ws, ...loadValues(l)],
    );
    return toLoad(rows[0]);
  }

  async updateLoad(ws: number, id: number, input: LoadInput): Promise<Load | null> {
    const l = await this.owned(ws, input);
    const { rows } = await this.pool.query(
      `UPDATE crm_loads SET ${LOAD_WRITE.map((c, i) => `${c} = $${i + 3}`).join(', ')}
        WHERE workspace_id = $1 AND id = $2 RETURNING ${LOAD_COLS}`,
      [ws, id, ...loadValues(l)],
    );
    return rows[0] ? toLoad(rows[0]) : null;
  }

  async deleteLoad(ws: number, id: number) {
    await this.pool.query('DELETE FROM crm_loads WHERE workspace_id = $1 AND id = $2', [ws, id]);
  }

  /** Bulk import from a spreadsheet: dispatchers and carriers are matched by name (case-insensitive) or created. */
  async importLoads(ws: number, rows: ImportRow[]): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const byName = async (table: 'crm_dispatchers' | 'crm_carriers', name: string, cache: Map<string, number>) => {
        const key = name.trim().toLowerCase();
        if (!key) return null;
        if (cache.has(key)) return cache.get(key)!;
        const found = await client.query(`SELECT id FROM ${table} WHERE workspace_id = $1 AND lower(name) = $2 AND NOT archived LIMIT 1`, [ws, key]);
        const id = found.rows[0]
          ? Number(found.rows[0].id)
          : Number((await client.query(`INSERT INTO ${table} (workspace_id, name) VALUES ($1, $2) RETURNING id`, [ws, name.trim()])).rows[0].id);
        cache.set(key, id);
        return id;
      };
      const dispatchers = new Map<string, number>();
      const carriers = new Map<string, number>();
      for (const r of rows) {
        await client.query(
          `INSERT INTO crm_loads (workspace_id, load_date, carrier_id, dispatcher_id, broker, pro, origin, destination, rate, loaded_miles)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [ws, r.date, await byName('crm_carriers', r.carrier, carriers), await byName('crm_dispatchers', r.dispatcher, dispatchers),
            r.broker, r.pro, r.origin, r.destination, r.rate, r.loadedMiles],
        );
      }
      await client.query('COMMIT');
      return rows.length;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
}
