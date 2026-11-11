import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import type { CrmCarrier, CrmState, CrmUser, Dispatcher, ImportRow, Load, LoadStatus } from './crm.types.js';

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
`;

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

const toDispatcher = (r: Record<string, unknown>): Dispatcher => ({ id: Number(r.id), name: String(r.name), percent: Number(r.percent) });
const toCarrier = (r: Record<string, unknown>): CrmCarrier => ({
  id: Number(r.id), name: String(r.name), mc: String(r.mc), dot: String(r.dot), phone: String(r.phone), email: String(r.email), notes: String(r.notes),
});
const toLoad = (r: Record<string, unknown>): Load => ({
  id: Number(r.id),
  date: r.load_date instanceof Date ? r.load_date.toISOString().slice(0, 10) : String(r.load_date).slice(0, 10),
  carrierId: r.carrier_id == null ? null : Number(r.carrier_id),
  dispatcherId: r.dispatcher_id == null ? null : Number(r.dispatcher_id),
  broker: String(r.broker), pro: String(r.pro), origin: String(r.origin), destination: String(r.destination),
  rate: Number(r.rate), notes: String(r.notes), status: String(r.status) as LoadStatus,
});

export type LoadInput = Omit<Load, 'id'>;
export type CarrierInput = Omit<CrmCarrier, 'id'>;

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
    const [d, c, l] = await Promise.all([
      this.pool.query('SELECT id, name, percent FROM crm_dispatchers WHERE workspace_id = $1 AND NOT archived ORDER BY name', [ws]),
      this.pool.query('SELECT id, name, mc, dot, phone, email, notes FROM crm_carriers WHERE workspace_id = $1 AND NOT archived ORDER BY name', [ws]),
      this.pool.query(
        `SELECT id, to_char(load_date, 'YYYY-MM-DD') AS load_date, carrier_id, dispatcher_id, broker, pro, origin, destination, rate, notes, status
           FROM crm_loads WHERE workspace_id = $1 ORDER BY load_date DESC, id DESC`,
        [ws],
      ),
    ]);
    return { user, dispatchers: d.rows.map(toDispatcher), carriers: c.rows.map(toCarrier), loads: l.rows.map(toLoad) };
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
      `INSERT INTO crm_carriers (workspace_id, name, mc, dot, phone, email, notes) VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, name, mc, dot, phone, email, notes`,
      [ws, c.name, c.mc, c.dot, c.phone, c.email, c.notes],
    );
    return toCarrier(rows[0]);
  }

  async updateCarrier(ws: number, id: number, c: CarrierInput): Promise<CrmCarrier | null> {
    const { rows } = await this.pool.query(
      `UPDATE crm_carriers SET name = $3, mc = $4, dot = $5, phone = $6, email = $7, notes = $8 WHERE workspace_id = $1 AND id = $2
       RETURNING id, name, mc, dot, phone, email, notes`,
      [ws, id, c.name, c.mc, c.dot, c.phone, c.email, c.notes],
    );
    return rows[0] ? toCarrier(rows[0]) : null;
  }

  async archiveCarrier(ws: number, id: number) {
    await this.pool.query('UPDATE crm_carriers SET archived = true WHERE workspace_id = $1 AND id = $2', [ws, id]);
  }

  // Loads

  /** Carrier and dispatcher ids must belong to the workspace; anything else is dropped to null. */
  private async owned(ws: number, l: LoadInput): Promise<LoadInput> {
    const { rows } = await this.pool.query(
      `SELECT (SELECT id FROM crm_carriers WHERE workspace_id = $1 AND id = $2) AS carrier,
              (SELECT id FROM crm_dispatchers WHERE workspace_id = $1 AND id = $3) AS dispatcher`,
      [ws, l.carrierId, l.dispatcherId],
    );
    return { ...l, carrierId: rows[0].carrier == null ? null : Number(rows[0].carrier), dispatcherId: rows[0].dispatcher == null ? null : Number(rows[0].dispatcher) };
  }

  async addLoad(ws: number, input: LoadInput): Promise<Load> {
    const l = await this.owned(ws, input);
    const { rows } = await this.pool.query(
      `INSERT INTO crm_loads (workspace_id, load_date, carrier_id, dispatcher_id, broker, pro, origin, destination, rate, notes, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id, to_char(load_date, 'YYYY-MM-DD') AS load_date, carrier_id, dispatcher_id, broker, pro, origin, destination, rate, notes, status`,
      [ws, l.date, l.carrierId, l.dispatcherId, l.broker, l.pro, l.origin, l.destination, l.rate, l.notes, l.status],
    );
    return toLoad(rows[0]);
  }

  async updateLoad(ws: number, id: number, input: LoadInput): Promise<Load | null> {
    const l = await this.owned(ws, input);
    const { rows } = await this.pool.query(
      `UPDATE crm_loads SET load_date = $3, carrier_id = $4, dispatcher_id = $5, broker = $6, pro = $7, origin = $8,
              destination = $9, rate = $10, notes = $11, status = $12
        WHERE workspace_id = $1 AND id = $2
       RETURNING id, to_char(load_date, 'YYYY-MM-DD') AS load_date, carrier_id, dispatcher_id, broker, pro, origin, destination, rate, notes, status`,
      [ws, id, l.date, l.carrierId, l.dispatcherId, l.broker, l.pro, l.origin, l.destination, l.rate, l.notes, l.status],
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
          `INSERT INTO crm_loads (workspace_id, load_date, carrier_id, dispatcher_id, broker, pro, origin, destination, rate)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [ws, r.date, await byName('crm_carriers', r.carrier, carriers), await byName('crm_dispatchers', r.dispatcher, dispatchers),
            r.broker, r.pro, r.origin, r.destination, r.rate],
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
