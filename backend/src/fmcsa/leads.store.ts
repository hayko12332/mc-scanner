import { Logger } from '@nestjs/common';
import { db } from '../db.js';
import type { LeadsDay } from './fmcsa.types.js';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS leads_days (
    day         TEXT PRIMARY KEY,
    data        JSONB NOT NULL,
    fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );
`;

/**
 * Bump when the rules that pick a day's leads change, so days saved under the old rules are fetched again once.
 * v2 (2026-11-15): grants still "Pending" in the registration file count (today's carriers were all dropped).
 */
const VERSION = 2;

/**
 * New-MC-leads days saved in Postgres, so a restart or an FMCSA outage / rate limit (HTTP 429) still serves the
 * last good data instead of an error. Without a database every call is a no-op.
 */
export class LeadsStore {
  private readonly logger = new Logger(LeadsStore.name);
  private ready: Promise<unknown> | null = null;

  private pool() {
    const pool = db();
    if (pool && !this.ready) this.ready = pool.query(SCHEMA).catch((e: Error) => this.logger.warn(`leads_days: ${e.message}`));
    return pool;
  }

  async get(day: string): Promise<{ data: LeadsDay; fetchedAt: number } | null> {
    const pool = this.pool();
    if (!pool) return null;
    try {
      await this.ready;
      const { rows } = await pool.query('SELECT data, fetched_at FROM leads_days WHERE day = $1', [day]);
      const saved = rows[0]?.data as (LeadsDay & { v?: number }) | undefined;
      if (!saved || saved.v !== VERSION) return null;
      const { v: _v, ...data } = saved;
      return { data, fetchedAt: new Date(rows[0].fetched_at).getTime() };
    } catch (e) {
      this.logger.warn(`Could not read saved leads for ${day}: ${(e as Error).message}`);
      return null;
    }
  }

  async put(day: string, data: LeadsDay) {
    const pool = this.pool();
    if (!pool) return;
    try {
      await this.ready;
      await pool.query(
        `INSERT INTO leads_days (day, data, fetched_at) VALUES ($1, $2, now())
         ON CONFLICT (day) DO UPDATE SET data = EXCLUDED.data, fetched_at = EXCLUDED.fetched_at`,
        [day, JSON.stringify({ ...data, v: VERSION })],
      );
    } catch (e) {
      this.logger.warn(`Could not save leads for ${day}: ${(e as Error).message}`);
    }
  }
}
