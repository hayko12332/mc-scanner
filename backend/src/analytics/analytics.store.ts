import { Logger } from '@nestjs/common';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import pg from 'pg';
import type { StoredEvent, StoredFeedback } from './analytics.types.js';

export interface AnalyticsStore {
  insert(events: StoredEvent[]): Promise<void>;
  insertFeedback(feedback: StoredFeedback): Promise<void>;
  /** Whether any event from this visitor is already stored. */
  hasVisitor(visitorId: string): Promise<boolean>;
  close(): Promise<void>;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS analytics_events (
    id          BIGSERIAL PRIMARY KEY,
    at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    visitor_id  TEXT NOT NULL,
    session_id  TEXT NOT NULL,
    event       TEXT NOT NULL,
    props       JSONB NOT NULL DEFAULT '{}'::jsonb,
    path        TEXT NOT NULL DEFAULT '',
    ip          TEXT NOT NULL DEFAULT '',
    country     TEXT NOT NULL DEFAULT '',
    user_agent  TEXT NOT NULL DEFAULT '',
    referrer    TEXT NOT NULL DEFAULT '',
    tg_user_id  BIGINT,
    tg_username TEXT NOT NULL DEFAULT '',
    tg_name     TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS analytics_events_at ON analytics_events (at);
  CREATE INDEX IF NOT EXISTS analytics_events_visitor ON analytics_events (visitor_id);
  CREATE TABLE IF NOT EXISTS feedback (
    id          BIGSERIAL PRIMARY KEY,
    at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    message     TEXT NOT NULL,
    contact     TEXT NOT NULL DEFAULT '',
    page        TEXT NOT NULL DEFAULT '',
    visitor_id  TEXT NOT NULL DEFAULT '',
    ip          TEXT NOT NULL DEFAULT '',
    country     TEXT NOT NULL DEFAULT '',
    user_agent  TEXT NOT NULL DEFAULT '',
    tg_user_id  BIGINT,
    tg_username TEXT NOT NULL DEFAULT '',
    tg_name     TEXT NOT NULL DEFAULT ''
  );
`;
const EVENT_COLUMNS = [
  'at', 'visitor_id', 'session_id', 'event', 'props', 'path', 'ip', 'country', 'user_agent', 'referrer',
  'tg_user_id', 'tg_username', 'tg_name',
];

/** Events go to analytics_events, suggestions to feedback; both tables are created on first start. */
export class PostgresStore implements AnalyticsStore {
  private readonly pool: pg.Pool;
  private readonly ready: Promise<unknown>;

  constructor(url: string) {
    // Hosted Postgres (Neon, Render, Supabase) requires TLS; local servers usually don't offer it.
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
    this.pool = new pg.Pool({ connectionString: url, max: 3, ssl: local ? undefined : { rejectUnauthorized: false } });
    this.ready = this.pool.query(SCHEMA);
  }

  async insert(events: StoredEvent[]): Promise<void> {
    if (!events.length) return;
    await this.ready;
    const values: unknown[] = [];
    const rows = events.map((e, i) => {
      values.push(e.at, e.visitorId, e.sessionId, e.event, JSON.stringify(e.props), e.path, e.ip, e.country,
        e.userAgent, e.referrer, e.tgUserId, e.tgUsername, e.tgName);
      return `(${EVENT_COLUMNS.map((_, j) => `$${i * EVENT_COLUMNS.length + j + 1}`).join(',')})`;
    });
    await this.pool.query(`INSERT INTO analytics_events (${EVENT_COLUMNS.join(',')}) VALUES ${rows.join(',')}`, values);
  }

  async insertFeedback(f: StoredFeedback): Promise<void> {
    await this.ready;
    await this.pool.query(
      `INSERT INTO feedback (at, message, contact, page, visitor_id, ip, country, user_agent, tg_user_id, tg_username, tg_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [f.at, f.message, f.contact, f.page, f.visitorId, f.ip, f.country, f.userAgent, f.tgUserId, f.tgUsername, f.tgName],
    );
  }

  async hasVisitor(visitorId: string): Promise<boolean> {
    await this.ready;
    const r = await this.pool.query('SELECT 1 FROM analytics_events WHERE visitor_id = $1 LIMIT 1', [visitorId]);
    return r.rowCount! > 0;
  }

  close() {
    return this.pool.end();
  }
}

/** Newline-delimited JSON files: fine for local runs; on Render's free plan the disk is wiped on every deploy. */
export class FileStore implements AnalyticsStore {
  /** Visitors seen since this server started (the file itself is not searched). */
  private readonly seen = new Set<string>();

  constructor(private readonly file: string) {}

  async insert(events: StoredEvent[]): Promise<void> {
    if (!events.length) return;
    for (const e of events) this.seen.add(e.visitorId);
    await this.append(this.file, events.map((e) => JSON.stringify(e) + '\n').join(''));
  }

  async hasVisitor(visitorId: string): Promise<boolean> {
    return this.seen.has(visitorId);
  }

  insertFeedback(f: StoredFeedback): Promise<void> {
    return this.append(join(dirname(this.file), 'feedback.ndjson'), JSON.stringify(f) + '\n');
  }

  async close() {}

  private async append(file: string, text: string) {
    await mkdir(dirname(file), { recursive: true });
    await appendFile(file, text);
  }
}

export function createStore(databaseUrl: string, file: string): AnalyticsStore {
  const logger = new Logger('Analytics');
  if (databaseUrl) {
    logger.log('Storing analytics and feedback in Postgres (tables analytics_events, feedback)');
    return new PostgresStore(databaseUrl);
  }
  logger.warn(`DATABASE_URL is not set: storing analytics and feedback next to ${file} (lost on redeploy on hosts without a persistent disk)`);
  return new FileStore(file);
}
