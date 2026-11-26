import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { config } from '../config.js';
import { db } from '../db.js';
import { FEATURES } from './features.js';
import { FREE } from './free.js';
import { SITE } from './layout.js';

// IndexNow: tells Bing (and Yandex, Seznam, Naver) right away which pages are new or changed, instead of waiting for
// them to crawl the sitemap. The key is public by design — the file /<key>.txt on the site proves the site is ours.
// Only the live site sends: the main pages a few minutes after each start, and every day the next batch of company
// pages (by MC number, so new MCs — higher numbers — follow automatically once all are sent).

export const INDEXNOW_KEY = '9f4abbbf2443acbe6ad287f0f0262a27';
const ENDPOINT = 'https://api.indexnow.org/indexnow';
/** Bing accepts up to 10,000 addresses a day per site. */
const DAILY = 9_000;
const SCHEMA = `CREATE TABLE IF NOT EXISTS indexnow_state (id INTEGER PRIMARY KEY DEFAULT 1, last_mc INTEGER NOT NULL DEFAULT 0, sent_on DATE, sent INTEGER NOT NULL DEFAULT 0)`;
const MAIN_PAGES = ['/', '/new-mc-leads', '/mc-number-lookup', '/mc-scanner', ...Object.keys(FEATURES), '/free-trucking-tools', ...Object.keys(FREE), '/carriers', '/privacy.html', '/terms.html'];

/** The JSON IndexNow takes for a list of addresses on our site. */
export function indexNowBody(paths: string[]) {
  return { host: new URL(SITE).host, key: INDEXNOW_KEY, keyLocation: `${SITE}/${INDEXNOW_KEY}.txt`, urlList: paths.map((p) => SITE + p) };
}

@Injectable()
export class IndexNowService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(IndexNowService.name);
  private timers: NodeJS.Timeout[] = [];

  onApplicationBootstrap() {
    // Only the real site: never from a laptop or a preview copy.
    if (!config.onRender || config.canonicalHost !== new URL(SITE).host || !db() || process.env.INDEXNOW === 'off') return;
    this.timers.push(setTimeout(() => void this.send(MAIN_PAGES, 'main pages'), 5 * 60_000));
    this.timers.push(setTimeout(() => void this.companies(), 10 * 60_000));
    this.timers.push(setInterval(() => void this.companies(), 6 * 3600_000));
  }

  onModuleDestroy() { this.timers.forEach((t) => clearTimeout(t)); }

  async send(paths: string[], what: string): Promise<boolean> {
    if (!paths.length) return true;
    try {
      const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(indexNowBody(paths)), signal: AbortSignal.timeout(60_000) });
      if (res.ok) { this.logger.log(`IndexNow: ${paths.length} ${what} sent (${res.status})`); return true; }
      this.logger.warn(`IndexNow: ${what} refused — HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    } catch (e) {
      this.logger.warn(`IndexNow: ${what} not sent — ${(e as Error).message}`);
    }
    return false;
  }

  /** Today's batch of company pages, at most DAILY a day, continuing after the last MC sent. */
  private async companies() {
    const pool = db();
    if (!pool) return;
    try {
      await pool.query(SCHEMA);
      await pool.query('INSERT INTO indexnow_state (id) VALUES (1) ON CONFLICT DO NOTHING');
      const { rows: [s] } = await pool.query(`SELECT last_mc, sent, (sent_on = CURRENT_DATE) AS today FROM indexnow_state WHERE id = 1`);
      const left = DAILY - (s.today ? Number(s.sent) : 0);
      if (left <= 0) return;
      const { rows } = await pool.query('SELECT mc FROM fmcsa_companies WHERE mc > $1 ORDER BY mc LIMIT $2', [Number(s.last_mc), left]);
      if (!rows.length) return;
      const mcs = rows.map((r) => Number(r.mc));
      if (!(await this.send(mcs.map((mc) => `/mc/${mc}`), 'company pages'))) return;
      await pool.query(`UPDATE indexnow_state SET last_mc = $1, sent = CASE WHEN sent_on = CURRENT_DATE THEN sent + $2 ELSE $2 END, sent_on = CURRENT_DATE WHERE id = 1`, [mcs.at(-1), mcs.length]);
    } catch (e) {
      this.logger.warn(`IndexNow companies: ${(e as Error).message}`);
    }
  }
}
