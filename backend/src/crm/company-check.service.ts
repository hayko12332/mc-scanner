import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { config } from '../config.js';
import { db } from '../db.js';
import { LookupService } from '../fmcsa/lookup.service.js';
import { parseLookupQuery } from '../fmcsa/lookup.query.js';
import { sendMail } from '../mail/mailer.js';
import { checkCompany, pickProfile, type CheckLevel, type CheckRole, type CompanyCheck } from './company-check.js';
import { CrmStore } from './crm.store.js';

const RANK: Record<CheckLevel, number> = { unknown: 0, ok: 1, caution: 2, danger: 3 };
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** FMCSA checks for the dispatch board, and the daily re-check of every carrier on a board. */
@Injectable()
export class CompanyCheckService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(CompanyCheckService.name);
  private timer?: NodeJS.Timeout;
  private store: CrmStore | null = null;
  private readonly cache = new Map<string, { at: number; check: CompanyCheck | null }>();

  constructor(private readonly lookup: LookupService) {}

  /** One MC as a broker or a carrier; null when FMCSA has no such MC. Cached for 30 minutes. */
  async check(mc: string, role: CheckRole): Promise<CompanyCheck | null> {
    const digits = mc.replace(/\D/g, '');
    const key = `${role}|${digits}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < 30 * 60_000) return hit.check;
    const parsed = parseLookupQuery(digits, 'mc');
    if (!parsed) return null;
    // Monitoring needs current data: a saved search result older than this cache is asked again.
    const result = await this.lookup.lookup(digits, parsed, { maxAgeMs: 30 * 60_000 });
    const profile = pickProfile(result.profiles, Number(digits));
    const check = profile ? checkCompany(profile, role) : null;
    this.cache.set(key, { at: Date.now(), check });
    return check;
  }

  onApplicationBootstrap() {
    if (!db()) return;
    // First run a few minutes after start (the store creates its tables first), then every hour.
    const run = () => void this.recheckCarriers().catch((e: Error) => this.logger.warn(`Carrier checks: ${e.message}`));
    setTimeout(run, 3 * 60_000).unref();
    this.timer = setInterval(run, 60 * 60_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  /** Re-checks carriers not checked for a day; emails the board owner about each one that got worse. */
  async recheckCarriers(limit = 60): Promise<number> {
    const pool = db();
    if (!pool) return 0;
    this.store ??= new CrmStore(pool);
    const due = await this.store.carriersToCheck(limit);
    const worse = new Map<string, { owner: string; items: { carrier: string; check: CompanyCheck; before: CompanyCheck }[] }>();
    for (const d of due) {
      const check = await this.check(d.mc, 'carrier').catch(() => null);
      if (!check) continue;
      const before = await this.store.saveCheck(d.ws, check);
      const newDanger = check.flags.some((f) => f.level === 'danger' && !before?.flags.some((b) => b.text === f.text));
      if (before && (RANK[check.level] > RANK[before.level] || newDanger)) {
        const w = worse.get(d.email) ?? { owner: d.owner, items: [] };
        w.items.push({ carrier: d.carrier, check, before });
        worse.set(d.email, w);
      }
    }
    for (const [email, w] of worse) await this.alert(email, w.owner, w.items).catch((e: Error) => this.logger.warn(`Alert mail: ${e.message}`));
    if (due.length) this.logger.log(`Carrier checks: ${due.length} checked, ${[...worse.values()].reduce((n, w) => n + w.items.length, 0)} got worse`);
    return due.length;
  }

  private async alert(to: string, owner: string, items: { carrier: string; check: CompanyCheck; before: CompanyCheck }[]) {
    const board = `${config.publicUrl || 'https://haulpanel.com'}/#/crm`;
    const lines = items.map((i) => `${i.carrier} (MC ${i.check.mc}): ${i.check.flags.map((f) => f.text).join('; ')}`);
    const subject = items.length === 1 ? `⚠️ ${items[0].carrier}: ${items[0].check.summary}` : `⚠️ ${items.length} of your carriers need attention`;
    const hi = owner.split(' ')[0] || 'there';
    await sendMail({
      to, subject,
      text: `Hi ${hi},\n\nOur daily FMCSA check found changes:\n\n${lines.join('\n')}\n\nOpen your board: ${board}\n\n— HaulPanel team`,
      html: `<p>Hi ${esc(hi)},</p><p>Our daily FMCSA check found changes:</p><ul>${items.map((i) =>
        `<li><b>${esc(i.carrier)}</b> (MC ${i.check.mc}): ${i.check.flags.map((f) => esc(f.text)).join('; ')}</li>`).join('')}</ul>
        <p><a href="${board}">Open your board</a></p><p>— HaulPanel team</p>`,
    });
  }
}
