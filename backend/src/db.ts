import { Logger } from '@nestjs/common';
import pg from 'pg';
import { config } from './config.js';

const logger = new Logger('Database');
let pool: pg.Pool | null = null;

/** Shared Postgres pool (DATABASE_URL), or null when the server runs without a database. */
export function db(): pg.Pool | null {
  if (!config.databaseUrl) return null;
  if (!pool) {
    // Hosted Postgres (Neon, Render, Supabase) requires TLS; local servers usually don't offer it.
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(config.databaseUrl);
    pool = new pg.Pool({ connectionString: config.databaseUrl, max: 4, ssl: local ? undefined : { rejectUnauthorized: false } });
    // An idle connection dropped by the network or by Neon must not crash the server; the pool reconnects on next use.
    pool.on('error', (e) => logger.warn(`Database connection dropped: ${e.message}`));
  }
  return pool;
}
