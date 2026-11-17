import { Logger } from '@nestjs/common';
import { db } from '../db.js';
import type { LookupResult } from './fmcsa.types.js';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS lookup_cache (
    key         TEXT PRIMARY KEY,
    data        JSONB NOT NULL,
    fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );
`;
/** Recent searches kept in memory too, so a repeat search does not even wait for the database. */
const MEMORY_MAX = 500;

export interface SavedLookup {
  result: LookupResult;
  at: number;
}

/**
 * Company-lookup results saved in Postgres. The FMCSA open-data API often takes 20–40 s per query or answers
 * HTTP 429, so a repeat search (or a page reload) is served from here, and an outage still shows the last result.
 * Without a database only the in-memory copy is used.
 */
export class LookupCache {
  private readonly logger = new Logger(LookupCache.name);
  private ready: Promise<unknown> | null = null;
  private readonly memory = new Map<string, SavedLookup>();

  private pool() {
    const pool = db();
    if (pool && !this.ready) this.ready = pool.query(SCHEMA).catch((e: Error) => this.logger.warn(`lookup_cache: ${e.message}`));
    return pool;
  }

  private remember(key: string, saved: SavedLookup) {
    this.memory.delete(key);
    this.memory.set(key, saved);
    if (this.memory.size > MEMORY_MAX) this.memory.delete(this.memory.keys().next().value!);
  }

  async get(key: string): Promise<SavedLookup | null> {
    const hit = this.memory.get(key);
    if (hit) return hit;
    const pool = this.pool();
    if (!pool) return null;
    try {
      await this.ready;
      const { rows } = await pool.query('SELECT data, fetched_at FROM lookup_cache WHERE key = $1', [key]);
      if (!rows[0]) return null;
      const saved = { result: rows[0].data as LookupResult, at: new Date(rows[0].fetched_at).getTime() };
      this.remember(key, saved);
      return saved;
    } catch (e) {
      this.logger.warn(`Could not read saved lookup ${key}: ${(e as Error).message}`);
      return null;
    }
  }

  async put(key: string, result: LookupResult) {
    this.remember(key, { result, at: Date.now() });
    const pool = this.pool();
    if (!pool) return;
    try {
      await this.ready;
      await pool.query(
        `INSERT INTO lookup_cache (key, data, fetched_at) VALUES ($1, $2, now())
         ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, fetched_at = EXCLUDED.fetched_at`,
        [key, JSON.stringify(result)],
      );
    } catch (e) {
      this.logger.warn(`Could not save lookup ${key}: ${(e as Error).message}`);
    }
  }
}
