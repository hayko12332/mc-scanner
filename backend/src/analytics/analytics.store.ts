import { Logger } from '@nestjs/common';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import pg from 'pg';
import type { StoredEvent } from './analytics.types.js';

export interface AnalyticsStore {
  insert(events: StoredEvent[]): Promise<void>;
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
`;
const COLUMNS = [
  'at', 'visitor_id', 'session_id', 'event', 'props', 'path', 'ip', 'country', 'user_agent', 'referrer',
  'tg_user_id', 'tg_username', 'tg_name',
];

/** Events go to the analytics_events table, created on first start. */
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
      return `(${COLUMNS.map((_, j) => `$${i * COLUMNS.length + j + 1}`).join(',')})`;
    });
    await this.pool.query(`INSERT INTO analytics_events (${COLUMNS.join(',')}) VALUES ${rows.join(',')}`, values);
  }

  close() {
    return this.pool.end();
  }
}

/** Newline-delimited JSON file: fine for local runs; on Render's free plan the disk is wiped on every deploy. */
export class FileStore implements AnalyticsStore {
  constructor(private readonly file: string) {}

  async insert(events: StoredEvent[]): Promise<void> {
    if (!events.length) return;
    await mkdir(dirname(this.file), { recursive: true });
    await appendFile(this.file, events.map((e) => JSON.stringify(e) + '\n').join(''));
  }

  async close() {}
}

export function createStore(databaseUrl: string, file: string): AnalyticsStore {
  const logger = new Logger('Analytics');
  if (databaseUrl) {
    logger.log('Storing analytics in Postgres (table analytics_events)');
    return new PostgresStore(databaseUrl);
  }
  logger.warn(`DATABASE_URL is not set: storing analytics in ${file} (lost on redeploy on hosts without a persistent disk)`);
  return new FileStore(file);
}
