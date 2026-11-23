import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { db } from '../db.js';
import { CARGO, mcDockets } from '../fmcsa/census.mapper.js';
import { toIsoDate } from '../fmcsa/normalize.js';
import { DATASETS, SocrataClient, type Row } from '../fmcsa/socrata.client.js';
import { companiesStore, type PublicCompany } from './companies.store.js';

// Weekly copy of every active company with an MC number from the FMCSA census (≈710k), for the public company
// pages. The census API answers 10k rows in a few seconds, so a full pass takes minutes; it runs in the background
// a minute after start when the copy is missing or older than a week, then is checked once a day.

const PAGE = 10_000;
const WEEK = 7 * 86_400_000;
const FIELDS = ['dot_number', 'legal_name', 'dba_name', 'phy_city', 'phy_state', 'power_units', 'total_drivers', 'carship', 'carrier_operation',
  'add_date', 'mcs150_date', 'docket1prefix', 'docket1', 'docket2prefix', 'docket2', 'docket3prefix', 'docket3', ...Object.keys(CARGO).map((k) => 'crgo_' + k)];
const clean = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const int = (s: string | undefined) => { const n = parseInt(s ?? '', 10); return Number.isFinite(n) && n >= 0 && n < 1e7 ? n : null; };
const date = (s: string | undefined) => { const d = toIsoDate(s); return d && /^\d{4}-\d\d-\d\d$/.test(d) ? d : null; };

/** One census record → one row per MC number on it. */
export function censusToCompanies(rec: Row): PublicCompany[] {
  const dot = int(rec.dot_number);
  const name = clean(rec.legal_name);
  if (dot == null || !name) return [];
  const cargo = Object.entries(CARGO).filter(([k]) => rec['crgo_' + k] === 'X').map(([, label]) => label);
  return [...new Set(mcDockets(rec))].filter((mc) => mc > 0 && mc < 1e8).map((mc) => ({
    mc, dot, name: name.slice(0, 200), dba: clean(rec.dba_name).slice(0, 200), city: clean(rec.phy_city).slice(0, 80), state: clean(rec.phy_state).slice(0, 2).toUpperCase(),
    kinds: clean(rec.carship).slice(0, 20), operation: clean(rec.carrier_operation).slice(0, 1),
    powerUnits: int(rec.power_units), drivers: int(rec.total_drivers), cargo: cargo.slice(0, 12),
    addedOn: date(rec.add_date), mcs150On: date(rec.mcs150_date),
  }));
}

@Injectable()
export class CompaniesSyncService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(CompaniesSyncService.name);
  private timer?: NodeJS.Timeout;
  private first?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly socrata: SocrataClient) {}

  onApplicationBootstrap() {
    if (!db() || process.env.VITEST || process.env.COMPANIES_SYNC === 'off') return;
    this.first = setTimeout(() => void this.maybeRun(), 60_000);
    this.timer = setInterval(() => void this.maybeRun(), 24 * 3600_000);
  }

  onModuleDestroy() { clearTimeout(this.first); clearInterval(this.timer); }

  private async maybeRun() {
    try {
      const last = await companiesStore.lastSync();
      if (last.at && Date.now() - last.at.getTime() < WEEK) return;
      await this.run();
    } catch (e) {
      this.logger.warn(`Company sync: ${(e as Error).message}`);
    }
  }

  /** A full pass, keyed by USDOT number so a slow or retried page never skips or repeats rows. */
  async run(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    const started = new Date();
    let after = 0, total = 0;
    try {
      for (;;) {
        const rows = await this.socrata.query(DATASETS.census, {
          $select: FIELDS.join(','),
          $where: `status_code='A' AND (docket1prefix='MC' OR docket2prefix='MC' OR docket3prefix='MC') AND dot_number > ${after}`,
          $order: 'dot_number',
          $limit: String(PAGE),
        });
        if (!rows.length) break;
        const companies = rows.flatMap(censusToCompanies);
        // One company can appear twice in a page (several census rows for one MC): keep the last.
        const unique = [...new Map(companies.map((c) => [c.mc, c])).values()];
        for (let i = 0; i < unique.length; i += 2000) await companiesStore.upsert(unique.slice(i, i + 2000));
        total += unique.length;
        after = int(rows.at(-1)!.dot_number) ?? after;
        if (rows.length < PAGE) break;
      }
      const gone = total > 100_000 ? await companiesStore.finish(started, total) : 0;
      this.logger.log(`Company sync: ${total} companies, ${gone} no longer active, ${Math.round((Date.now() - started.getTime()) / 1000)} s`);
      return total;
    } finally {
      this.running = false;
    }
  }
}
