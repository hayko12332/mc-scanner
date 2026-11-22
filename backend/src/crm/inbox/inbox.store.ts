import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import type { Fit } from './match.js';
import type { PostingFields } from './read-email.js';

// A board's email inbox at HaulPanel: its address, autopilot rules, the emails that came in and the loads in them.

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS crm_inbox (
    workspace_id  BIGINT PRIMARY KEY REFERENCES crm_workspaces(id) ON DELETE CASCADE,
    token         TEXT UNIQUE NOT NULL,
    auto_email    BOOLEAN NOT NULL DEFAULT false,
    min_rpm       NUMERIC(6,2) NOT NULL DEFAULT 2.50,
    max_deadhead  INT NOT NULL DEFAULT 150,
    daily_cap     INT NOT NULL DEFAULT 40
  );
  CREATE TABLE IF NOT EXISTS crm_inbox_messages (
    id            BIGSERIAL PRIMARY KEY,
    workspace_id  BIGINT NOT NULL REFERENCES crm_workspaces(id) ON DELETE CASCADE,
    received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    from_addr     TEXT NOT NULL DEFAULT '',
    subject       TEXT NOT NULL DEFAULT '',
    kind          TEXT NOT NULL DEFAULT 'other',
    summary       TEXT NOT NULL DEFAULT '',
    postings      INT NOT NULL DEFAULT 0,
    load_id       BIGINT REFERENCES crm_loads(id) ON DELETE SET NULL,
    note          TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS crm_inbox_messages_ws ON crm_inbox_messages (workspace_id, received_at DESC);
  CREATE TABLE IF NOT EXISTS crm_postings (
    id            BIGSERIAL PRIMARY KEY,
    workspace_id  BIGINT NOT NULL REFERENCES crm_workspaces(id) ON DELETE CASCADE,
    message_id    BIGINT REFERENCES crm_inbox_messages(id) ON DELETE SET NULL,
    key           TEXT NOT NULL,
    data          JSONB NOT NULL,
    fit           JSONB NOT NULL,
    status        TEXT NOT NULL DEFAULT 'new',
    emailed_at    TIMESTAMPTZ,
    emailed_auto  BOOLEAN NOT NULL DEFAULT false,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, key)
  );
  CREATE INDEX IF NOT EXISTS crm_postings_ws ON crm_postings (workspace_id, created_at DESC);
`;

export interface InboxSettings { token: string; autoEmail: boolean; minRpm: number; maxDeadhead: number; dailyCap: number }
export interface InboxMessage { id: number; receivedAt: string; from: string; subject: string; kind: string; summary: string; postings: number; loadId: number | null; note: string }
export interface PostingRow { id: number; createdAt: string; status: 'new' | 'emailed' | 'dismissed'; emailedAt: string | null; emailedAuto: boolean; data: PostingFields; fit: Fit }

const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());

export class InboxStore {
  private readonly ready: Promise<unknown>;

  constructor(private readonly pool: pg.Pool, after: Promise<unknown> = Promise.resolve()) {
    this.ready = after.then(() => pool.query(SCHEMA));
  }

  /** The board's inbox (made on first use with a random, unguessable address). */
  async settings(ws: number): Promise<InboxSettings> {
    await this.ready;
    await this.pool.query('INSERT INTO crm_inbox (workspace_id, token) VALUES ($1, $2) ON CONFLICT (workspace_id) DO NOTHING', [ws, `loads-${randomBytes(6).toString('hex')}`]);
    const r = (await this.pool.query('SELECT * FROM crm_inbox WHERE workspace_id = $1', [ws])).rows[0];
    return { token: String(r.token), autoEmail: !!r.auto_email, minRpm: Number(r.min_rpm), maxDeadhead: Number(r.max_deadhead), dailyCap: Number(r.daily_cap) };
  }

  async saveSettings(ws: number, s: Omit<InboxSettings, 'token'>) {
    await this.settings(ws);
    await this.pool.query('UPDATE crm_inbox SET auto_email = $2, min_rpm = $3, max_deadhead = $4, daily_cap = $5 WHERE workspace_id = $1', [ws, s.autoEmail, s.minRpm, s.maxDeadhead, s.dailyCap]);
  }

  /** Which board an address belongs to (the part before @). */
  async boardOf(token: string): Promise<number | null> {
    await this.ready;
    const r = await this.pool.query('SELECT workspace_id FROM crm_inbox WHERE token = $1', [token.toLowerCase()]);
    return r.rows[0] ? Number(r.rows[0].workspace_id) : null;
  }

  async addMessage(ws: number, m: { from: string; subject: string }): Promise<number> {
    await this.ready;
    const r = await this.pool.query('INSERT INTO crm_inbox_messages (workspace_id, from_addr, subject) VALUES ($1,$2,$3) RETURNING id', [ws, m.from.slice(0, 200), m.subject.slice(0, 300)]);
    return Number(r.rows[0].id);
  }

  async setMessage(id: number, m: { kind: string; summary: string; postings?: number; loadId?: number | null; note?: string }) {
    await this.pool.query('UPDATE crm_inbox_messages SET kind = $2, summary = $3, postings = $4, load_id = $5, note = $6 WHERE id = $1',
      [id, m.kind, m.summary.slice(0, 200), m.postings ?? 0, m.loadId ?? null, (m.note ?? '').slice(0, 500)]);
  }

  /** Saves new postings; ones already seen (same broker + ref, or same lane/date/rate) are skipped. Returns the new ones. */
  async addPostings(ws: number, messageId: number, rows: { key: string; data: PostingFields; fit: Fit }[]): Promise<PostingRow[]> {
    const out: PostingRow[] = [];
    for (const p of rows) {
      const r = await this.pool.query(
        `INSERT INTO crm_postings (workspace_id, message_id, key, data, fit) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (workspace_id, key) DO NOTHING RETURNING *`,
        [ws, messageId, p.key.slice(0, 300), JSON.stringify(p.data), JSON.stringify(p.fit)]);
      if (r.rows[0]) out.push(toPosting(r.rows[0]));
    }
    return out;
  }

  async posting(ws: number, id: number): Promise<PostingRow | null> {
    await this.ready;
    const r = await this.pool.query('SELECT * FROM crm_postings WHERE workspace_id = $1 AND id = $2', [ws, id]);
    return r.rows[0] ? toPosting(r.rows[0]) : null;
  }

  async postings(ws: number, days = 3): Promise<PostingRow[]> {
    await this.ready;
    const r = await this.pool.query(`SELECT * FROM crm_postings WHERE workspace_id = $1 AND created_at > now() - make_interval(days => $2) ORDER BY created_at DESC, id DESC LIMIT 300`, [ws, days]);
    return r.rows.map(toPosting);
  }

  async messages(ws: number): Promise<InboxMessage[]> {
    await this.ready;
    const r = await this.pool.query('SELECT * FROM crm_inbox_messages WHERE workspace_id = $1 ORDER BY received_at DESC LIMIT 30', [ws]);
    return r.rows.map((m) => ({ id: Number(m.id), receivedAt: iso(m.received_at)!, from: String(m.from_addr), subject: String(m.subject), kind: String(m.kind), summary: String(m.summary), postings: Number(m.postings), loadId: m.load_id == null ? null : Number(m.load_id), note: String(m.note) }));
  }

  /** Marks a posting emailed; false if it already was (so no broker gets two emails about one load). */
  async markEmailed(ws: number, id: number, auto: boolean): Promise<boolean> {
    const r = await this.pool.query(`UPDATE crm_postings SET status = 'emailed', emailed_at = now(), emailed_auto = $3 WHERE workspace_id = $1 AND id = $2 AND emailed_at IS NULL`, [ws, id, auto]);
    return !!r.rowCount;
  }

  async unmarkEmailed(ws: number, id: number) {
    await this.pool.query(`UPDATE crm_postings SET status = 'new', emailed_at = NULL WHERE workspace_id = $1 AND id = $2`, [ws, id]);
  }

  async dismiss(ws: number, id: number) {
    await this.pool.query(`UPDATE crm_postings SET status = 'dismissed' WHERE workspace_id = $1 AND id = $2 AND status = 'new'`, [ws, id]);
  }

  async autoEmailedToday(ws: number): Promise<number> {
    const r = await this.pool.query(`SELECT count(*) FROM crm_postings WHERE workspace_id = $1 AND emailed_auto AND emailed_at > now() - interval '24 hours'`, [ws]);
    return Number(r.rows[0].count);
  }

  /** The board owner: auto-emails are signed by them and replies go to them. */
  async owner(ws: number): Promise<{ name: string; email: string } | null> {
    const r = await this.pool.query('SELECT u.name, u.email FROM crm_workspaces w JOIN crm_users u ON u.id = w.owner_id WHERE w.id = $1', [ws]);
    return r.rows[0] ? { name: String(r.rows[0].name), email: String(r.rows[0].email) } : null;
  }
}

function toPosting(r: Record<string, unknown>): PostingRow {
  return {
    id: Number(r.id), createdAt: iso(r.created_at)!, status: (['emailed', 'dismissed'].includes(String(r.status)) ? r.status : 'new') as PostingRow['status'],
    emailedAt: iso(r.emailed_at), emailedAuto: !!r.emailed_auto, data: r.data as PostingFields, fit: r.fit as Fit,
  };
}
