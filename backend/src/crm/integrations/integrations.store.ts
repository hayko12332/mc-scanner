import type pg from 'pg';
import { unitKey, type EldHos, type EldProvider, type EldRegion, type EldUnit } from './eld.js';
import { open, seal } from './vault.js';

// Connected partner accounts of a workspace (ELD now; QuickBooks next) and what the ELD last reported per vehicle.
// Secrets are sealed with vault.ts; they never leave this file in plain text except to call the partner.

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS crm_integrations (
    workspace_id  BIGINT NOT NULL REFERENCES crm_workspaces(id) ON DELETE CASCADE,
    provider      TEXT NOT NULL,
    region        TEXT NOT NULL DEFAULT 'us',
    secret        TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'ok',
    error         TEXT NOT NULL DEFAULT '',
    connected_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    synced_at     TIMESTAMPTZ,
    PRIMARY KEY (workspace_id, provider)
  );
  -- What the connection is called on the partner's side (e.g. the QuickBooks company name)
  ALTER TABLE crm_integrations ADD COLUMN IF NOT EXISTS label TEXT NOT NULL DEFAULT '';
  -- Invoices created in QuickBooks for loads, and whether QuickBooks says they're paid
  CREATE TABLE IF NOT EXISTS crm_qbo_invoices (
    load_id       BIGINT PRIMARY KEY REFERENCES crm_loads(id) ON DELETE CASCADE,
    workspace_id  BIGINT NOT NULL REFERENCES crm_workspaces(id) ON DELETE CASCADE,
    qbo_id        TEXT NOT NULL,
    doc_number    TEXT NOT NULL,
    pushed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    paid_at       TIMESTAMPTZ
  );
  -- HaulPanel's OAuth client at each MCP server (registered on the fly, once per return address)
  CREATE TABLE IF NOT EXISTS crm_mcp_clients (
    app           TEXT NOT NULL,
    redirect      TEXT NOT NULL,
    client_id     TEXT NOT NULL,
    client_secret TEXT NOT NULL DEFAULT '',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (app, redirect)
  );
  -- Vehicles as the ELD reports them; truck_id is the board truck it's linked to (by unit number, or by hand)
  CREATE TABLE IF NOT EXISTS crm_eld_units (
    workspace_id  BIGINT NOT NULL REFERENCES crm_workspaces(id) ON DELETE CASCADE,
    provider      TEXT NOT NULL,
    vehicle_id    TEXT NOT NULL,
    name          TEXT NOT NULL DEFAULT '',
    vin           TEXT NOT NULL DEFAULT '',
    truck_id      BIGINT REFERENCES crm_trucks(id) ON DELETE SET NULL,
    linked        TEXT NOT NULL DEFAULT 'auto',
    lat           DOUBLE PRECISION,
    lon           DOUBLE PRECISION,
    at            TIMESTAMPTZ,
    speed_mph     REAL,
    heading       REAL,
    address       TEXT NOT NULL DEFAULT '',
    driver        TEXT NOT NULL DEFAULT '',
    hos           JSONB,
    seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, provider, vehicle_id)
  );
`;

export interface Connection { provider: string; region: string; label: string; status: 'ok' | 'error'; error: string; connectedAt: string; syncedAt: string | null; invoices?: number }

/** A vehicle from the ELD, as the board shows it. */
export interface EldView {
  provider: EldProvider; vehicleId: string; name: string; truckId: number | null; linked: 'auto' | 'manual' | 'none';
  lat: number | null; lon: number | null; at: string | null; speedMph: number | null; heading: number | null; address: string; driver: string;
  hos: Pick<EldHos, 'status' | 'driveLeftMin' | 'shiftLeftMin' | 'cycleLeftMin' | 'breakLeftMin'> | null;
}

const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());

export class IntegrationsStore {
  private readonly ready: Promise<unknown>;

  /** `after`: the board's own tables (workspaces, trucks) exist first. */
  constructor(private readonly pool: pg.Pool, after: Promise<unknown> = Promise.resolve()) {
    this.ready = after.then(() => pool.query(SCHEMA));
  }

  async connect(ws: number, provider: string, region: EldRegion | 'us', secret: string, label = '') {
    await this.ready;
    await this.pool.query(
      `INSERT INTO crm_integrations (workspace_id, provider, region, secret, synced_at, label) VALUES ($1,$2,$3,$4, now(), $5)
       ON CONFLICT (workspace_id, provider) DO UPDATE SET region = EXCLUDED.region, secret = EXCLUDED.secret, status = 'ok', error = '', connected_at = now(), synced_at = now(), label = EXCLUDED.label`,
      [ws, provider, region, seal(secret), label.slice(0, 200)]);
  }

  /** The opened secret of one connection, or null. */
  async secretOf(ws: number, provider: string): Promise<string | null> {
    await this.ready;
    const { rows } = await this.pool.query('SELECT secret FROM crm_integrations WHERE workspace_id = $1 AND provider = $2', [ws, provider]);
    if (!rows[0]) return null;
    try { return open(String(rows[0].secret)); } catch { return null; }
  }

  async mcpClient(app: string, redirect: string): Promise<{ clientId: string; clientSecret: string } | null> {
    await this.ready;
    const { rows } = await this.pool.query('SELECT client_id, client_secret FROM crm_mcp_clients WHERE app = $1 AND redirect = $2', [app, redirect]);
    if (!rows[0]) return null;
    let secret = '';
    try { secret = rows[0].client_secret ? open(String(rows[0].client_secret)) : '' } catch { return null }
    return { clientId: String(rows[0].client_id), clientSecret: secret };
  }

  async saveMcpClient(app: string, redirect: string, c: { clientId: string; clientSecret: string }) {
    await this.ready;
    await this.pool.query(
      `INSERT INTO crm_mcp_clients (app, redirect, client_id, client_secret) VALUES ($1,$2,$3,$4)
       ON CONFLICT (app, redirect) DO UPDATE SET client_id = EXCLUDED.client_id, client_secret = EXCLUDED.client_secret, created_at = now()`,
      [app, redirect, c.clientId, c.clientSecret ? seal(c.clientSecret) : '']);
  }

  /** Rotated tokens are saved right away (the old ones stop working). */
  async setSecret(ws: number, provider: string, secret: string) {
    await this.pool.query('UPDATE crm_integrations SET secret = $3 WHERE workspace_id = $1 AND provider = $2', [ws, provider, seal(secret)]);
  }

  async markOk(ws: number, provider: string) {
    await this.pool.query(`UPDATE crm_integrations SET status = 'ok', error = '', synced_at = now() WHERE workspace_id = $1 AND provider = $2`, [ws, provider]);
  }

  async qboPushed(ws: number, loadId: number, qboId: string, docNumber: string) {
    await this.pool.query(
      `INSERT INTO crm_qbo_invoices (load_id, workspace_id, qbo_id, doc_number) VALUES ($1,$2,$3,$4)
       ON CONFLICT (load_id) DO UPDATE SET qbo_id = EXCLUDED.qbo_id, doc_number = EXCLUDED.doc_number, pushed_at = now(), paid_at = NULL`,
      [loadId, ws, qboId, docNumber]);
  }

  /** Invoices in QuickBooks whose loads aren't paid yet on the board. */
  async qboOpen(ws: number): Promise<{ loadId: number; qboId: string }[]> {
    const { rows } = await this.pool.query(
      `SELECT q.load_id, q.qbo_id FROM crm_qbo_invoices q JOIN crm_loads l ON l.id = q.load_id
        WHERE q.workspace_id = $1 AND q.paid_at IS NULL AND l.status <> 'paid'`, [ws]);
    return rows.map((r) => ({ loadId: Number(r.load_id), qboId: String(r.qbo_id) }));
  }

  async qboPaid(ws: number, loadIds: number[]) {
    await this.pool.query('UPDATE crm_qbo_invoices SET paid_at = now() WHERE workspace_id = $1 AND load_id = ANY($2)', [ws, loadIds]);
  }

  async qboLoads(ws: number): Promise<number[]> {
    const { rows } = await this.pool.query('SELECT load_id FROM crm_qbo_invoices WHERE workspace_id = $1', [ws]);
    return rows.map((r) => Number(r.load_id));
  }

  async disconnect(ws: number, provider: string) {
    await this.ready;
    await this.pool.query('DELETE FROM crm_integrations WHERE workspace_id = $1 AND provider = $2', [ws, provider]);
    await this.pool.query('DELETE FROM crm_eld_units WHERE workspace_id = $1 AND provider = $2', [ws, provider]);
    if (provider === 'quickbooks') await this.pool.query('DELETE FROM crm_qbo_invoices WHERE workspace_id = $1', [ws]);
  }

  async connections(ws: number): Promise<Connection[]> {
    await this.ready;
    const { rows } = await this.pool.query(
      `SELECT provider, region, label, status, error, connected_at, synced_at,
              CASE WHEN provider = 'quickbooks' THEN (SELECT count(*) FROM crm_qbo_invoices q WHERE q.workspace_id = i.workspace_id) END AS invoices
         FROM crm_integrations i WHERE workspace_id = $1 ORDER BY provider`, [ws]);
    return rows.map((r) => ({
      provider: String(r.provider), region: String(r.region), label: String(r.label ?? ''), status: r.status === 'error' ? 'error' : 'ok', error: String(r.error),
      connectedAt: iso(r.connected_at)!, syncedAt: iso(r.synced_at), ...(r.invoices == null ? {} : { invoices: Number(r.invoices) }),
    }));
  }

  /** Every connection of these providers, with its secret opened — for the background sync only. */
  async allOf(providers: string[]): Promise<{ ws: number; provider: string; region: string; secret: string }[]> {
    await this.ready;
    const { rows } = await this.pool.query('SELECT workspace_id, provider, region, secret FROM crm_integrations WHERE provider = ANY($1) ORDER BY synced_at NULLS FIRST', [providers]);
    return rows.flatMap((r) => {
      try { return [{ ws: Number(r.workspace_id), provider: String(r.provider), region: String(r.region), secret: open(String(r.secret)) }]; } catch { return []; }
    });
  }

  async markError(ws: number, provider: string, error: string) {
    await this.pool.query(`UPDATE crm_integrations SET status = 'error', error = $3, synced_at = now() WHERE workspace_id = $1 AND provider = $2`, [ws, provider, error.slice(0, 300)]);
  }

  /**
   * Saves what the ELD reported: each vehicle (linked to the board truck with the same unit number unless the
   * dispatcher chose otherwise), its HOS clocks, and — for linked trucks — the newest position on the map.
   */
  async applyFleet(ws: number, provider: EldProvider, units: EldUnit[], hos: EldHos[]): Promise<{ vehicles: number; linked: number }> {
    await this.ready;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const trucks = (await client.query('SELECT id, unit FROM crm_trucks WHERE workspace_id = $1 AND NOT archived', [ws])).rows;
      const byUnit = new Map<string, number>();
      for (const t of trucks) { const k = unitKey(String(t.unit)); if (k && !byUnit.has(k)) byUnit.set(k, Number(t.id)); }
      const known = new Map((await client.query('SELECT vehicle_id, truck_id, linked FROM crm_eld_units WHERE workspace_id = $1 AND provider = $2', [ws, provider])).rows
        .map((r) => [String(r.vehicle_id), { truckId: r.truck_id == null ? null : Number(r.truck_id), linked: String(r.linked) }]));
      const hosOf = (u: EldUnit) => hos.find((h) => h.vehicleId && h.vehicleId === u.vehicleId) ?? hos.find((h) => h.driverId && h.driverId === u.driverId) ?? null;
      let linked = 0;
      for (const u of units.slice(0, 2000)) {
        const k = known.get(u.vehicleId);
        // A link set by hand (or "not this truck") stays; otherwise follow the unit number.
        const truckId = k && k.linked !== 'auto' ? k.truckId : byUnit.get(unitKey(u.name)) ?? null;
        const h = hosOf(u);
        // A link the dispatcher changed while this sync ran is kept (only 'auto' links follow the unit number).
        const saved = await client.query(
          `INSERT INTO crm_eld_units (workspace_id, provider, vehicle_id, name, vin, truck_id, linked, lat, lon, at, speed_mph, heading, address, driver, hos, seen_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, now())
           ON CONFLICT (workspace_id, provider, vehicle_id) DO UPDATE SET name = EXCLUDED.name, vin = EXCLUDED.vin,
             truck_id = CASE WHEN crm_eld_units.linked = 'auto' THEN EXCLUDED.truck_id ELSE crm_eld_units.truck_id END,
             lat = COALESCE(EXCLUDED.lat, crm_eld_units.lat), lon = COALESCE(EXCLUDED.lon, crm_eld_units.lon), at = COALESCE(EXCLUDED.at, crm_eld_units.at),
             speed_mph = EXCLUDED.speed_mph, heading = EXCLUDED.heading, address = EXCLUDED.address, driver = EXCLUDED.driver, hos = EXCLUDED.hos, seen_at = now()
           RETURNING truck_id`,
          [ws, provider, u.vehicleId, u.name.slice(0, 120), u.vin.slice(0, 40), truckId, k?.linked ?? 'auto', u.lat, u.lon, u.at, u.speedMph, u.heading,
            u.address.slice(0, 200), (h?.driver || u.driver).slice(0, 120),
            h ? JSON.stringify({ status: h.status, driveLeftMin: h.driveLeftMin, shiftLeftMin: h.shiftLeftMin, cycleLeftMin: h.cycleLeftMin, breakLeftMin: h.breakLeftMin }) : null]);
        const tid = saved.rows[0]?.truck_id == null ? null : Number(saved.rows[0].truck_id);
        if (tid == null) continue;
        linked++;
        if (u.lat == null || u.lon == null || !u.at) continue;
        await savePoint(client, ws, tid, u);
      }
      // Vehicles the ELD no longer lists (sold, deactivated) go away.
      await client.query('DELETE FROM crm_eld_units WHERE workspace_id = $1 AND provider = $2 AND NOT (vehicle_id = ANY($3))', [ws, provider, units.map((u) => u.vehicleId)]);
      await client.query(`UPDATE crm_integrations SET status = 'ok', error = '', synced_at = now() WHERE workspace_id = $1 AND provider = $2`, [ws, provider]);
      await client.query('COMMIT');
      return { vehicles: units.length, linked };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  /** The dispatcher links a vehicle to a truck by hand (or says it's none of the board's trucks). */
  async link(ws: number, provider: string, vehicleId: string, truckId: number | null) {
    await this.ready;
    const own = truckId == null ? true : (await this.pool.query('SELECT 1 FROM crm_trucks WHERE workspace_id = $1 AND id = $2', [ws, truckId])).rowCount;
    if (!own) return false;
    const r = await this.pool.query(
      `UPDATE crm_eld_units SET truck_id = $4, linked = $5 WHERE workspace_id = $1 AND provider = $2 AND vehicle_id = $3
       RETURNING lat, lon, at, speed_mph AS "speedMph", heading`,
      [ws, provider, vehicleId, truckId, truckId == null ? 'none' : 'manual']);
    // The truck shows on the map right away, not at the next sync.
    const u = r.rows[0];
    if (truckId != null && u?.lat != null && u.lon != null && u.at) await savePoint(this.pool, ws, truckId, { ...u, at: iso(u.at) });
    return !!r.rowCount;
  }

  /** Breadcrumbs from the ELD's own history (a truck just connected or linked), at most one per 2 minutes. */
  async addTrail(ws: number, truckId: number, pts: { lat: number; lon: number; at: string; speedMph: number | null }[]) {
    if (!pts.length) return;
    const rows = pts.slice(-2000);
    await this.pool.query(
      `INSERT INTO crm_trail (truck_id, workspace_id, at, lat, lon, speed_mph)
       SELECT $1, $2, x.at, x.lat, x.lon, x.speed FROM unnest($3::timestamptz[], $4::float8[], $5::float8[], $6::real[]) AS x(at, lat, lon, speed)
       ON CONFLICT DO NOTHING`,
      [truckId, ws, rows.map((p) => p.at), rows.map((p) => p.lat), rows.map((p) => p.lon), rows.map((p) => p.speedMph)]);
  }

  /** Breadcrumbs older than 8 days go away (all boards). */
  async pruneTrail() {
    await this.ready;
    await this.pool.query(`DELETE FROM crm_trail WHERE at < now() - interval '8 days'`);
  }

  /** Linked trucks that have no breadcrumbs in the last day (their history is worth asking the ELD for). */
  async trucksWithoutTrail(ws: number, provider: string): Promise<{ truckId: number; vehicleId: string }[]> {
    const { rows } = await this.pool.query(
      `SELECT u.truck_id, u.vehicle_id FROM crm_eld_units u
        WHERE u.workspace_id = $1 AND u.provider = $2 AND u.truck_id IS NOT NULL
          AND (SELECT count(*) FROM crm_trail t WHERE t.truck_id = u.truck_id AND t.at > now() - interval '24 hours') < 3`, [ws, provider]);
    return rows.map((r) => ({ truckId: Number(r.truck_id), vehicleId: String(r.vehicle_id) }));
  }

  async units(ws: number): Promise<EldView[]> {
    await this.ready;
    const { rows } = await this.pool.query(
      `SELECT provider, vehicle_id, name, truck_id, linked, lat, lon, at, speed_mph, heading, address, driver, hos FROM crm_eld_units WHERE workspace_id = $1 ORDER BY name`, [ws]);
    return rows.map((r) => ({
      provider: r.provider as EldProvider, vehicleId: String(r.vehicle_id), name: String(r.name), truckId: r.truck_id == null ? null : Number(r.truck_id),
      linked: (['manual', 'none'].includes(String(r.linked)) ? r.linked : 'auto') as EldView['linked'],
      lat: r.lat == null ? null : Number(r.lat), lon: r.lon == null ? null : Number(r.lon), at: iso(r.at),
      speedMph: r.speed_mph == null ? null : Number(r.speed_mph), heading: r.heading == null ? null : Number(r.heading),
      address: String(r.address), driver: String(r.driver), hos: (r.hos as EldView['hos']) ?? null,
    }));
  }
}

/** Saves an ELD point as the truck's position (the newest point wins, ELD or Telegram) and as a breadcrumb. */
async function savePoint(q: Pick<pg.Pool, 'query'>, ws: number, truckId: number, u: { lat: number | null; lon: number | null; at: string | null; speedMph: number | null; heading: number | null }) {
  if (u.lat == null || u.lon == null || !u.at) return;
  await q.query(
    `INSERT INTO crm_positions (truck_id, workspace_id, lat, lon, at, speed_mph, heading, source) VALUES ($1,$2,$3,$4,$5,$6,$7,'eld')
     ON CONFLICT (truck_id) DO UPDATE SET lat = EXCLUDED.lat, lon = EXCLUDED.lon, at = EXCLUDED.at, speed_mph = EXCLUDED.speed_mph, heading = EXCLUDED.heading, source = 'eld'
       WHERE crm_positions.at < EXCLUDED.at`,
    [truckId, ws, u.lat, u.lon, u.at, u.speedMph, u.heading]);
  await q.query('INSERT INTO crm_trail (truck_id, workspace_id, at, lat, lon, speed_mph) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
    [truckId, ws, u.at, u.lat, u.lon, u.speedMph]);
}
