import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import type { CompanyCheck } from './company-check.js';
import type { CompanyInput, CrmCarrier, CrmState, CrmUser, Dispatcher, FeeType, ImportRow, Load, LoadStatus, Truck } from './crm.types.js';

const SESSION_DAYS = 60;
export type CodePurpose = 'verify' | 'reset';

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
  -- Accounts: email + password sign-up (verified by a code), Google sign-in, and the company behind the workspace
  ALTER TABLE crm_users ALTER COLUMN google_sub DROP NOT NULL;
  ALTER TABLE crm_users ADD COLUMN IF NOT EXISTS password_hash TEXT;
  ALTER TABLE crm_users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false;
  ALTER TABLE crm_users ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT '';
  UPDATE crm_users SET email_verified = true WHERE google_sub IS NOT NULL AND NOT email_verified;
  CREATE INDEX IF NOT EXISTS crm_users_email ON crm_users (lower(email));
  ALTER TABLE crm_workspaces ADD COLUMN IF NOT EXISTS company_name TEXT NOT NULL DEFAULT '';
  ALTER TABLE crm_workspaces ADD COLUMN IF NOT EXISTS company_type TEXT NOT NULL DEFAULT '';
  ALTER TABLE crm_workspaces ADD COLUMN IF NOT EXISTS company_mc TEXT NOT NULL DEFAULT '';
  ALTER TABLE crm_workspaces ADD COLUMN IF NOT EXISTS company_dot TEXT NOT NULL DEFAULT '';
  ALTER TABLE crm_workspaces ADD COLUMN IF NOT EXISTS company_phone TEXT NOT NULL DEFAULT '';
  ALTER TABLE crm_workspaces ADD COLUMN IF NOT EXISTS fleet_size TEXT NOT NULL DEFAULT '';
  ALTER TABLE crm_loads ADD COLUMN IF NOT EXISTS broker_mc TEXT NOT NULL DEFAULT '';
  -- FMCSA checks of carriers (re-checked daily, the owner is emailed when one gets worse) and brokers
  CREATE TABLE IF NOT EXISTS crm_checks (
    workspace_id  BIGINT NOT NULL REFERENCES crm_workspaces(id) ON DELETE CASCADE,
    role          TEXT NOT NULL,
    mc            TEXT NOT NULL,
    level         TEXT NOT NULL,
    data          JSONB NOT NULL,
    checked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, role, mc)
  );
  -- Documents of a load (rate con, BOL, POD, …), kept in the database for now (at most 300 MB per board)
  CREATE TABLE IF NOT EXISTS crm_files (
    id            BIGSERIAL PRIMARY KEY,
    workspace_id  BIGINT NOT NULL REFERENCES crm_workspaces(id) ON DELETE CASCADE,
    load_id       BIGINT REFERENCES crm_loads(id) ON DELETE CASCADE,
    kind          TEXT NOT NULL DEFAULT 'other',
    name          TEXT NOT NULL,
    mime          TEXT NOT NULL,
    size          INTEGER NOT NULL,
    data          BYTEA NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS crm_files_ws_load ON crm_files (workspace_id, load_id);
  -- Invoices emailed to brokers, with optional reminders while unpaid
  CREATE TABLE IF NOT EXISTS crm_invoices (
    load_id       BIGINT PRIMARY KEY REFERENCES crm_loads(id) ON DELETE CASCADE,
    workspace_id  BIGINT NOT NULL REFERENCES crm_workspaces(id) ON DELETE CASCADE,
    number        TEXT NOT NULL,
    sent_to       TEXT NOT NULL,
    sent_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    remind        BOOLEAN NOT NULL DEFAULT true,
    reminders     INTEGER NOT NULL DEFAULT 0,
    reminded_at   TIMESTAMPTZ
  );
  CREATE TABLE IF NOT EXISTS crm_broker_emails (
    workspace_id  BIGINT NOT NULL REFERENCES crm_workspaces(id) ON DELETE CASCADE,
    broker        TEXT NOT NULL,
    email         TEXT NOT NULL,
    PRIMARY KEY (workspace_id, broker)
  );
  -- Team: dispatchers invited by the owner sign in with their own account and see only their own loads
  CREATE TABLE IF NOT EXISTS crm_members (
    user_id       BIGINT PRIMARY KEY REFERENCES crm_users(id) ON DELETE CASCADE,
    workspace_id  BIGINT NOT NULL REFERENCES crm_workspaces(id) ON DELETE CASCADE,
    role          TEXT NOT NULL DEFAULT 'dispatcher',
    dispatcher_id BIGINT REFERENCES crm_dispatchers(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS crm_invites (
    id            BIGSERIAL PRIMARY KEY,
    token_hash    TEXT UNIQUE NOT NULL,
    workspace_id  BIGINT NOT NULL REFERENCES crm_workspaces(id) ON DELETE CASCADE,
    email         TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'dispatcher',
    dispatcher_id BIGINT REFERENCES crm_dispatchers(id) ON DELETE CASCADE,
    expires_at    TIMESTAMPTZ NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS crm_email_codes (
    email       TEXT NOT NULL,
    purpose     TEXT NOT NULL,
    code_hash   TEXT NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    attempts    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (email, purpose)
  );
`;

const CARRIER_COLS = 'id, name, mc, dot, phone, email, notes, fee_type, fee, factoring';
const TRUCK_COLS = 'id, carrier_id, unit, driver, phone';
const LOAD_COLS = `id, to_char(load_date, 'YYYY-MM-DD') AS load_date, carrier_id, dispatcher_id, broker, pro, origin, destination, rate, notes,
  status, truck_id, loaded_miles, empty_miles, detention, layover, tonu, other, lumper,
  to_char(invoiced_on, 'YYYY-MM-DD') AS invoiced_on, to_char(paid_on, 'YYYY-MM-DD') AS paid_on, broker_mc`;
/** Load columns written by insert/update, in the order of loadValues(). */
const LOAD_WRITE = ['load_date', 'carrier_id', 'dispatcher_id', 'broker', 'pro', 'origin', 'destination', 'rate', 'notes', 'status',
  'truck_id', 'loaded_miles', 'empty_miles', 'detention', 'layover', 'tonu', 'other', 'lumper', 'invoiced_on', 'paid_on', 'broker_mc'];
const loadValues = (l: LoadInput) => [l.date, l.carrierId, l.dispatcherId, l.broker, l.pro, l.origin, l.destination, l.rate, l.notes, l.status,
  l.truckId, l.loadedMiles, l.emptyMiles, l.detention, l.layover, l.tonu, l.other, l.lumper, l.invoicedOn, l.paidOn, l.brokerMc];

export const FILE_KINDS = ['ratecon', 'bol', 'pod', 'invoice', 'other'] as const;
export type FileKind = (typeof FILE_KINDS)[number];
export interface CrmFile { id: number; loadId: number | null; kind: FileKind; name: string; mime: string; size: number; createdAt: string }
const FILE_COLS = 'id, load_id, kind, name, mime, size, created_at';
const MAX_BOARD_BYTES = 300 * 1024 * 1024;
const toFile = (r: Record<string, unknown>): CrmFile => ({
  id: Number(r.id), loadId: r.load_id == null ? null : Number(r.load_id), kind: String(r.kind) as FileKind, name: String(r.name),
  mime: String(r.mime), size: Number(r.size), createdAt: new Date(r.created_at as string).toISOString(),
});

export type MemberRole = 'owner' | 'dispatcher';
export interface Invite { id: number; email: string; dispatcherId: number | null; expiresAt: string }
export interface Team { members: { userId: number; name: string; email: string; dispatcherId: number | null }[]; invites: Invite[] }
const toInvite = (r: Record<string, unknown>): Invite => ({
  id: Number(r.id), email: String(r.email), dispatcherId: r.dispatcher_id == null ? null : Number(r.dispatcher_id), expiresAt: new Date(r.expires_at as string).toISOString(),
});

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
  invoicedOn: day(r.invoiced_on), paidOn: day(r.paid_on), brokerMc: String(r.broker_mc ?? ''),
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

  private toUser = (r: Record<string, unknown>): CrmUser => ({ id: Number(r.id), email: String(r.email), name: String(r.name), picture: String(r.picture ?? '') });

  private async ensureWorkspace(userId: number) {
    await this.pool.query('INSERT INTO crm_workspaces (owner_id) VALUES ($1) ON CONFLICT (owner_id) DO NOTHING', [userId]);
  }

  /** The account for an email (oldest first if old data has duplicates), with what sign-in needs. */
  async findByEmail(email: string): Promise<(CrmUser & { passwordHash: string | null; verified: boolean; googleSub: string | null }) | null> {
    await this.ready;
    const { rows } = await this.pool.query(
      'SELECT id, email, name, picture, password_hash, email_verified, google_sub FROM crm_users WHERE lower(email) = $1 ORDER BY id LIMIT 1', [email]);
    const r = rows[0];
    return r ? { ...this.toUser(r), passwordHash: r.password_hash, verified: r.email_verified, googleSub: r.google_sub } : null;
  }

  /**
   * Google sign-in: the account with this Google id, else the account with the same email (Google has verified it,
   * so the two are linked), else a new account. Linking to an account whose email was never verified drops its
   * password, so someone who signed up with another person's email cannot keep access.
   */
  async signIn(p: { sub: string; email: string; name: string; picture: string }): Promise<CrmUser> {
    await this.ready;
    const bySub = await this.pool.query(
      'UPDATE crm_users SET name = $2, picture = $3, email_verified = true WHERE google_sub = $1 RETURNING id, email, name, picture', [p.sub, p.name, p.picture]);
    let row = bySub.rows[0];
    if (!row) {
      const existing = p.email ? await this.findByEmail(p.email.toLowerCase()) : null;
      if (existing && !existing.googleSub) {
        const linked = await this.pool.query(
          `UPDATE crm_users SET google_sub = $2, picture = $3, name = CASE WHEN name = '' THEN $4 ELSE name END,
             password_hash = CASE WHEN email_verified THEN password_hash ELSE NULL END, email_verified = true
           WHERE id = $1 RETURNING id, email, name, picture`, [existing.id, p.sub, p.picture, p.name]);
        row = linked.rows[0];
      } else {
        const created = await this.pool.query(
          `INSERT INTO crm_users (google_sub, email, name, picture, email_verified) VALUES ($1,$2,$3,$4,true) RETURNING id, email, name, picture`,
          [p.sub, p.email, p.name, p.picture]);
        row = created.rows[0];
      }
    }
    const user = this.toUser(row);
    await this.ensureWorkspace(user.id);
    return user;
  }

  /**
   * Email sign-up: a new unverified account, or (if this email signed up before but never confirmed it) the same
   * account with the new details. Returns null when a confirmed account already uses the email.
   */
  async signUp(p: { email: string; name: string; passwordHash: string; phone: string; company: CompanyInput }): Promise<CrmUser | null> {
    await this.ready;
    const existing = await this.findByEmail(p.email);
    if (existing && (existing.verified || existing.googleSub)) return null;
    const { rows } = existing
      ? await this.pool.query('UPDATE crm_users SET name = $2, password_hash = $3, phone = $4 WHERE id = $1 RETURNING id, email, name, picture',
        [existing.id, p.name, p.passwordHash, p.phone])
      : await this.pool.query('INSERT INTO crm_users (email, name, password_hash, phone) VALUES ($1,$2,$3,$4) RETURNING id, email, name, picture',
        [p.email, p.name, p.passwordHash, p.phone]);
    const user = this.toUser(rows[0]);
    await this.ensureWorkspace(user.id);
    await this.setCompany(user.id, p.company);
    return user;
  }

  async markVerified(userId: number) {
    await this.pool.query('UPDATE crm_users SET email_verified = true WHERE id = $1', [userId]);
  }

  async setPassword(userId: number, passwordHash: string) {
    await this.pool.query('UPDATE crm_users SET password_hash = $2, email_verified = true WHERE id = $1', [userId, passwordHash]);
    // A new password signs out every other device.
    await this.pool.query('DELETE FROM crm_sessions WHERE user_id = $1', [userId]);
  }

  /** Company details of the user's workspace (asked at sign-up, or right after the first Google sign-in). */
  async setCompany(userId: number, c: CompanyInput) {
    await this.pool.query(
      `UPDATE crm_workspaces SET company_name = $2, company_type = $3, company_mc = $4, company_dot = $5, company_phone = $6, fleet_size = $7
       WHERE owner_id = $1`, [userId, c.name, c.type, c.mc, c.dot, c.phone, c.fleetSize]);
  }

  async company(ws: number): Promise<CompanyInput> {
    const { rows } = await this.pool.query(
      'SELECT company_name, company_type, company_mc, company_dot, company_phone, fleet_size FROM crm_workspaces WHERE id = $1', [ws]);
    const r = rows[0] ?? {};
    return { name: r.company_name ?? '', type: r.company_type ?? '', mc: r.company_mc ?? '', dot: r.company_dot ?? '', phone: r.company_phone ?? '', fleetSize: r.fleet_size ?? '' };
  }

  // One-time email codes (verification and password reset): stored hashed, 15 minutes, 5 tries.

  async saveCode(email: string, purpose: CodePurpose, hash: string) {
    await this.ready;
    await this.pool.query(
      `INSERT INTO crm_email_codes (email, purpose, code_hash, expires_at, attempts) VALUES ($1,$2,$3, now() + interval '15 minutes', 0)
       ON CONFLICT (email, purpose) DO UPDATE SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at, attempts = 0`,
      [email, purpose, hash]);
  }

  /** 'ok' (and the code is used up), 'wrong', or 'expired' (also after 5 wrong tries). */
  async useCode(email: string, purpose: CodePurpose, hash: string): Promise<'ok' | 'wrong' | 'expired'> {
    await this.ready;
    const { rows } = await this.pool.query(
      'UPDATE crm_email_codes SET attempts = attempts + 1 WHERE email = $1 AND purpose = $2 RETURNING code_hash, attempts, expires_at > now() AS fresh',
      [email, purpose]);
    const r = rows[0];
    if (!r || !r.fresh || r.attempts > 5) return 'expired';
    if (r.code_hash !== hash) return 'wrong';
    await this.pool.query('DELETE FROM crm_email_codes WHERE email = $1 AND purpose = $2', [email, purpose]);
    return 'ok';
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
  /**
   * The signed-in user and the board they work on for a session cookie, or null. A dispatcher invited to someone's
   * board works on that board (role 'dispatcher', limited to their own loads); everyone else owns their own board.
   */
  async session(token: string): Promise<{ user: CrmUser; workspaceId: number; role: MemberRole; dispatcherId: number | null } | null> {
    if (!token) return null;
    await this.ready;
    const { rows } = await this.pool.query(
      `SELECT u.id, u.email, u.name, u.picture, coalesce(m.workspace_id, w.id) AS workspace_id,
              coalesce(m.role, 'owner') AS role, m.dispatcher_id
         FROM crm_sessions s JOIN crm_users u ON u.id = s.user_id
         LEFT JOIN crm_members m ON m.user_id = u.id
         LEFT JOIN crm_workspaces w ON w.owner_id = u.id
        WHERE s.token_hash = $1 AND s.expires_at > now() AND coalesce(m.workspace_id, w.id) IS NOT NULL`,
      [hash(token)],
    );
    const r = rows[0];
    return r ? {
      user: { id: Number(r.id), email: r.email, name: r.name, picture: r.picture }, workspaceId: Number(r.workspace_id),
      role: r.role === 'dispatcher' ? 'dispatcher' : 'owner', dispatcherId: r.dispatcher_id == null ? null : Number(r.dispatcher_id),
    } : null;
  }

  // Team

  /** A one-week invite link for a dispatcher of this board; returns the token to put in the link. */
  async createInvite(ws: number, email: string, dispatcherId: number): Promise<{ token: string; invite: Invite }> {
    const own = await this.pool.query('SELECT 1 FROM crm_dispatchers WHERE workspace_id = $1 AND id = $2 AND NOT archived', [ws, dispatcherId]);
    if (!own.rows[0]) throw new Error('Pick one of your dispatchers');
    await this.pool.query('DELETE FROM crm_invites WHERE workspace_id = $1 AND (dispatcher_id = $2 OR lower(email) = $3)', [ws, dispatcherId, email]);
    const token = randomBytes(24).toString('base64url');
    const { rows } = await this.pool.query(
      `INSERT INTO crm_invites (token_hash, workspace_id, email, dispatcher_id, expires_at) VALUES ($1,$2,$3,$4, now() + interval '7 days')
       RETURNING id, email, dispatcher_id, expires_at`, [hash(token), ws, email, dispatcherId]);
    return { token, invite: toInvite(rows[0]) };
  }

  /** What an invite link is for (shown before signing in), or null when it is unknown or expired. */
  async invite(token: string): Promise<{ id: number; ws: number; email: string; dispatcherId: number | null; company: string; dispatcher: string } | null> {
    await this.ready;
    const { rows } = await this.pool.query(
      `SELECT i.id, i.workspace_id, i.email, i.dispatcher_id, w.company_name, d.name AS dispatcher
         FROM crm_invites i JOIN crm_workspaces w ON w.id = i.workspace_id LEFT JOIN crm_dispatchers d ON d.id = i.dispatcher_id
        WHERE i.token_hash = $1 AND i.expires_at > now()`, [hash(token)]);
    const r = rows[0];
    return r ? { id: Number(r.id), ws: Number(r.workspace_id), email: String(r.email), dispatcherId: r.dispatcher_id == null ? null : Number(r.dispatcher_id),
      company: String(r.company_name ?? ''), dispatcher: String(r.dispatcher ?? '') } : null;
  }

  /** Joins the board of the invite (replacing any earlier membership) and uses up the invite. */
  async acceptInvite(inviteId: number, ws: number, userId: number, dispatcherId: number | null) {
    await this.pool.query(
      `INSERT INTO crm_members (user_id, workspace_id, role, dispatcher_id) VALUES ($1,$2,'dispatcher',$3)
       ON CONFLICT (user_id) DO UPDATE SET workspace_id = EXCLUDED.workspace_id, role = 'dispatcher', dispatcher_id = EXCLUDED.dispatcher_id, created_at = now()`,
      [userId, ws, dispatcherId]);
    await this.pool.query('DELETE FROM crm_invites WHERE id = $1', [inviteId]);
  }

  async team(ws: number): Promise<Team> {
    const [m, i] = await Promise.all([
      this.pool.query(`SELECT u.id, u.name, u.email, m.dispatcher_id FROM crm_members m JOIN crm_users u ON u.id = m.user_id WHERE m.workspace_id = $1 ORDER BY u.name`, [ws]),
      this.pool.query(`SELECT id, email, dispatcher_id, expires_at FROM crm_invites WHERE workspace_id = $1 AND expires_at > now() ORDER BY id`, [ws]),
    ]);
    return {
      members: m.rows.map((r) => ({ userId: Number(r.id), name: String(r.name), email: String(r.email), dispatcherId: r.dispatcher_id == null ? null : Number(r.dispatcher_id) })),
      invites: i.rows.map(toInvite),
    };
  }

  async removeInvite(ws: number, id: number) {
    await this.pool.query('DELETE FROM crm_invites WHERE workspace_id = $1 AND id = $2', [ws, id]);
  }

  /** Takes a team member off the board (they keep their account) and signs them out everywhere. */
  async removeMember(ws: number, userId: number) {
    const { rowCount } = await this.pool.query('DELETE FROM crm_members WHERE workspace_id = $1 AND user_id = $2', [ws, userId]);
    if (rowCount) await this.pool.query('DELETE FROM crm_sessions WHERE user_id = $1', [userId]);
  }

  async endSession(token: string) {
    await this.pool.query('DELETE FROM crm_sessions WHERE token_hash = $1', [hash(token)]);
  }

  async state(ws: number, user: CrmUser): Promise<CrmState> {
    await this.ready;
    const [d, c, t, l, k, f, inv, be] = await Promise.all([
      this.pool.query('SELECT id, name, percent FROM crm_dispatchers WHERE workspace_id = $1 AND NOT archived ORDER BY name', [ws]),
      this.pool.query(`SELECT ${CARRIER_COLS} FROM crm_carriers WHERE workspace_id = $1 AND NOT archived ORDER BY name`, [ws]),
      this.pool.query(`SELECT ${TRUCK_COLS} FROM crm_trucks WHERE workspace_id = $1 AND NOT archived ORDER BY unit, driver`, [ws]),
      this.pool.query(`SELECT ${LOAD_COLS} FROM crm_loads WHERE workspace_id = $1 ORDER BY load_date DESC, id DESC`, [ws]),
      this.pool.query('SELECT data FROM crm_checks WHERE workspace_id = $1', [ws]),
      this.pool.query(`SELECT ${FILE_COLS} FROM crm_files WHERE workspace_id = $1 ORDER BY id`, [ws]),
      this.pool.query(`SELECT load_id, number, sent_to, sent_at, remind, reminders FROM crm_invoices WHERE workspace_id = $1`, [ws]),
      this.pool.query('SELECT broker, email FROM crm_broker_emails WHERE workspace_id = $1', [ws]),
    ]);
    return {
      user, company: await this.company(ws),
      dispatchers: d.rows.map(toDispatcher), carriers: c.rows.map(toCarrier), trucks: t.rows.map(toTruck), loads: l.rows.map(toLoad),
      checks: k.rows.map((r) => r.data as CompanyCheck),
      files: f.rows.map(toFile),
      invoices: inv.rows.map((r) => ({
        loadId: Number(r.load_id), number: String(r.number), sentTo: String(r.sent_to), sentAt: new Date(r.sent_at).toISOString(),
        remind: !!r.remind, reminders: Number(r.reminders),
      })),
      brokerEmails: Object.fromEntries(be.rows.map((r) => [String(r.broker), String(r.email)])),
    };
  }

  // Files (documents of a load)

  /** Adds a document to a load of this board; null when the load isn't theirs. Throws when the board is full. */
  async addFile(ws: number, loadId: number, f: { kind: FileKind; name: string; mime: string; data: Buffer }): Promise<CrmFile | null> {
    const own = await this.pool.query('SELECT 1 FROM crm_loads WHERE workspace_id = $1 AND id = $2', [ws, loadId]);
    if (!own.rows[0]) return null;
    const used = await this.pool.query('SELECT coalesce(sum(size), 0)::bigint AS n FROM crm_files WHERE workspace_id = $1', [ws]);
    if (Number(used.rows[0].n) + f.data.length > MAX_BOARD_BYTES) throw new Error('Your board has no room for more files (300 MB). Delete old documents first.');
    const { rows } = await this.pool.query(
      `INSERT INTO crm_files (workspace_id, load_id, kind, name, mime, size, data) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${FILE_COLS}`,
      [ws, loadId, f.kind, f.name, f.mime, f.data.length, f.data]);
    return toFile(rows[0]);
  }

  async file(ws: number, id: number): Promise<(CrmFile & { data: Buffer }) | null> {
    const { rows } = await this.pool.query(`SELECT ${FILE_COLS}, data FROM crm_files WHERE workspace_id = $1 AND id = $2`, [ws, id]);
    return rows[0] ? { ...toFile(rows[0]), data: rows[0].data as Buffer } : null;
  }

  async filesOf(ws: number, loadId: number, ids: number[]): Promise<(CrmFile & { data: Buffer })[]> {
    if (!ids.length) return [];
    const { rows } = await this.pool.query(
      `SELECT ${FILE_COLS}, data FROM crm_files WHERE workspace_id = $1 AND load_id = $2 AND id = ANY($3::bigint[]) ORDER BY array_position($3::bigint[], id)`,
      [ws, loadId, ids]);
    return rows.map((r) => ({ ...toFile(r), data: r.data as Buffer }));
  }

  async setFileKind(ws: number, id: number, kind: FileKind) {
    await this.pool.query('UPDATE crm_files SET kind = $3 WHERE workspace_id = $1 AND id = $2', [ws, id, kind]);
  }

  async deleteFile(ws: number, id: number) {
    await this.pool.query('DELETE FROM crm_files WHERE workspace_id = $1 AND id = $2', [ws, id]);
  }

  // Invoices

  async loadById(ws: number, id: number): Promise<Load | null> {
    const { rows } = await this.pool.query(`SELECT ${LOAD_COLS} FROM crm_loads WHERE workspace_id = $1 AND id = $2`, [ws, id]);
    return rows[0] ? toLoad(rows[0]) : null;
  }

  /** Records a sent invoice, remembers the broker's billing email, and marks the load invoiced today (if it wasn't). */
  async invoiceSent(ws: number, load: Load, number: string, to: string, remind: boolean, today: string) {
    await this.pool.query(
      `INSERT INTO crm_invoices (load_id, workspace_id, number, sent_to, remind) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (load_id) DO UPDATE SET number = EXCLUDED.number, sent_to = EXCLUDED.sent_to, sent_at = now(), remind = EXCLUDED.remind`,
      [load.id, ws, number, to, remind]);
    if (load.broker.trim()) {
      await this.pool.query(
        `INSERT INTO crm_broker_emails (workspace_id, broker, email) VALUES ($1, lower($2), $3)
         ON CONFLICT (workspace_id, broker) DO UPDATE SET email = EXCLUDED.email`, [ws, load.broker.trim(), to]);
    }
    if (!load.invoicedOn && load.status !== 'paid') {
      await this.pool.query(`UPDATE crm_loads SET status = 'invoiced', invoiced_on = $3 WHERE workspace_id = $1 AND id = $2`, [ws, load.id, today]);
    }
  }

  async setReminders(ws: number, loadId: number, remind: boolean) {
    await this.pool.query('UPDATE crm_invoices SET remind = $3 WHERE workspace_id = $1 AND load_id = $2', [ws, loadId, remind]);
  }

  /**
   * Unpaid invoices past their terms that should get a reminder: at most 3, a week apart. With the board's company
   * and the owner (replies go to them).
   */
  async remindersDue(termsDays: number): Promise<{ ws: number; load: Load; number: string; to: string; reminders: number; ownerEmail: string; ownerName: string }[]> {
    await this.ready;
    const { rows } = await this.pool.query(
      `SELECT i.workspace_id, i.number, i.sent_to, i.reminders, u.email AS owner_email, u.name AS owner_name, v.*
         FROM crm_invoices i JOIN crm_loads l ON l.id = i.load_id
         JOIN LATERAL (SELECT ${LOAD_COLS} FROM crm_loads x WHERE x.id = l.id) v ON true
         JOIN crm_workspaces w ON w.id = i.workspace_id JOIN crm_users u ON u.id = w.owner_id
        WHERE i.remind AND i.reminders < 3 AND l.status = 'invoiced' AND l.paid_on IS NULL
          AND l.invoiced_on + $1::int <= current_date
          AND (i.reminded_at IS NULL OR i.reminded_at < now() - interval '7 days')
        LIMIT 50`, [termsDays]);
    return rows.map((r) => ({
      ws: Number(r.workspace_id), load: toLoad(r), number: String(r.number), to: String(r.sent_to), reminders: Number(r.reminders),
      ownerEmail: String(r.owner_email), ownerName: String(r.owner_name),
    }));
  }

  async reminded(loadId: number) {
    await this.pool.query('UPDATE crm_invoices SET reminders = reminders + 1, reminded_at = now() WHERE load_id = $1', [loadId]);
  }

  // FMCSA checks

  /** Saves a check and returns the one it replaces (to tell whether things got worse). */
  async saveCheck(ws: number, c: CompanyCheck): Promise<CompanyCheck | null> {
    if (c.mc == null) return null;
    await this.ready;
    const { rows } = await this.pool.query(
      `WITH old AS (SELECT data FROM crm_checks WHERE workspace_id = $1 AND role = $2 AND mc = $3)
       INSERT INTO crm_checks (workspace_id, role, mc, level, data, checked_at) VALUES ($1,$2,$3,$4,$5, now())
       ON CONFLICT (workspace_id, role, mc) DO UPDATE SET level = EXCLUDED.level, data = EXCLUDED.data, checked_at = now()
       RETURNING (SELECT data FROM old) AS previous`,
      [ws, c.role, String(c.mc), c.level, JSON.stringify(c)]);
    return (rows[0]?.previous as CompanyCheck | null) ?? null;
  }

  /**
   * Carriers due for their daily FMCSA check (never checked, or more than 20 hours ago), with the owner to tell.
   * Archived carriers and workspaces without an MC on the carrier are skipped.
   */
  async carriersToCheck(limit: number): Promise<{ ws: number; mc: string; carrier: string; email: string; owner: string }[]> {
    await this.ready;
    const { rows } = await this.pool.query(
      `SELECT * FROM (
         SELECT DISTINCT ON (c.workspace_id, d.mc) c.workspace_id AS ws, d.mc, c.name AS carrier, u.email, u.name AS owner, k.checked_at
           FROM crm_carriers c
           CROSS JOIN LATERAL (SELECT regexp_replace(c.mc, '\D', '', 'g') AS mc) d
           JOIN crm_workspaces w ON w.id = c.workspace_id JOIN crm_users u ON u.id = w.owner_id
           LEFT JOIN crm_checks k ON k.workspace_id = c.workspace_id AND k.role = 'carrier' AND k.mc = d.mc
          WHERE NOT c.archived AND d.mc ~ '^[0-9]{3,8}$' AND (k.checked_at IS NULL OR k.checked_at < now() - interval '20 hours')
          ORDER BY c.workspace_id, d.mc
       ) due ORDER BY checked_at NULLS FIRST LIMIT $1`, [limit]);
    return rows.map((r) => ({ ws: Number(r.ws), mc: String(r.mc), carrier: String(r.carrier), email: String(r.email), owner: String(r.owner) }));
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
