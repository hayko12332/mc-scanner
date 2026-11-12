import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { buildAuthority, LEGACY_FIELDS, MOTUS_FIELDS, summarizeMotus, type AuthorityMode } from './authority.mapper.js';
import { CENSUS_FIELDS, censusCompany, censusToCarriers } from './census.mapper.js';
import { LEAD_KINDS, type Authority, type Carrier, type LeadKind, type LeadsDay, type ScanResult } from './fmcsa.types.js';
import { docketToMc, docketVariants, joinAddress, legacyDocket } from './normalize.js';
import { LeadsStore } from './leads.store.js';
import { DATASETS, inList, SocrataClient } from './socrata.client.js';

/** Keeps Socrata URLs short: IN lists are split into chunks of this many values. */
const CHUNK = 150;
const chunks = <T>(items: T[], size = CHUNK) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

/** Authority types and Census entity codes per kind of lead. */
const AUTH_TYPE: Record<LeadKind, string> = { carrier: 'Motor Carrier of Property%', broker: 'Broker of Property%' };
const CARSHIP: Record<LeadKind, string> = { carrier: '%C%', broker: '%B%' };

const DAY_MS = 86_400_000;
/** Without the dataset's update time, a saved day is trusted this long. */
const FALLBACK_TTL = 6 * 3_600_000;
/** A day loaded without emails (Census down) is tried again after this long. */
const PARTIAL_RETRY = 10 * 60_000;
/** Days kept warm in the background, so every period on the site answers from memory. */
const WARM_DAYS = 31;

/** YYYY-MM-DD in US Eastern time, `back` days ago (FMCSA dates its grants in Eastern time). */
export function easternDay(back = 0, now = Date.now()): string {
  return new Date(now - back * DAY_MS).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

interface SavedDay { fetchedAt: number; data: LeadsDay }

@Injectable()
export class CarriersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CarriersService.name);
  /** Lead days in memory: carrier days by date, broker days as "broker:<date>". */
  private readonly days = new Map<string, SavedDay>();
  private readonly inflight = new Map<string, Promise<LeadsDay>>();
  private readonly leadsStore = new LeadsStore();
  /** When FMCSA's authority file last changed, and when we last asked. */
  private version = { at: 0, checkedAt: 0 };
  private warmedVersion = -1;
  private warmTimer: NodeJS.Timeout | null = null;
  /** While the Company Census file is failing, skip it (and its slow retries) until this time. */
  private censusDownUntil = 0;

  constructor(private readonly socrata: SocrataClient) {}

  onModuleInit() {
    if (process.env.VITEST || process.env.NODE_ENV === 'test') return;
    // Check for FMCSA's daily update every 10 minutes; the first run fills the cache shortly after start.
    const tick = () => void this.warm().catch((e: Error) => this.logger.warn(`Warming leads: ${e.message}`));
    setTimeout(tick, 15_000).unref();
    this.warmTimer = setInterval(tick, 10 * 60_000);
    this.warmTimer.unref();
  }

  onModuleDestroy() {
    if (this.warmTimer) clearInterval(this.warmTimer);
  }

  /**
   * "New MC leads": carriers (or brokers) whose authority was granted on `date` (YYYY-MM-DD), with a phone or email,
   * still active today. Since mid-2026 new MC numbers are random 8-digit dockets, so they are found by grant date
   * (Motus authority history) rather than by walking MC numbers.
   *
   * Answers come from memory or the database; a day is fetched again from FMCSA only after FMCSA's file changed
   * (once a day, about 10:10 UTC). Out-of-date recent days are refreshed before answering, older ones in the background.
   */
  newOn(date: string, kind: LeadKind = 'carrier'): Promise<LeadsDay> {
    return this.day(date, kind, Date.now() - Date.parse(date) < 3 * DAY_MS);
  }

  private async day(date: string, kind: LeadKind, waitIfStale: boolean): Promise<LeadsDay> {
    const key = kind === 'carrier' ? date : `${kind}:${date}`;
    let have = this.days.get(key);
    if (!have) {
      const saved = await this.leadsStore.get(key);
      if (saved) this.remember(key, (have = { fetchedAt: saved.fetchedAt, data: saved.data }));
    }
    if (have && (await this.isCurrent(have))) return have.data;

    const refresh = this.refresh(date, kind, key);
    if (have && !waitIfStale) {
      refresh.catch(() => undefined);
      return have.data;
    }
    try {
      return await refresh;
    } catch (e) {
      // FMCSA outage or rate limit (HTTP 429): the last good copy beats an error.
      if (have) return have.data;
      throw e;
    }
  }

  private async isCurrent(d: SavedDay): Promise<boolean> {
    if (d.data.partial && Date.now() - d.fetchedAt > PARTIAL_RETRY) return false;
    const version = await this.dataVersion();
    return version ? d.fetchedAt >= version : Date.now() - d.fetchedAt < FALLBACK_TTL;
  }

  /** When FMCSA's authority history file last changed (checked at most every 5 minutes); 0 if unknown. */
  private async dataVersion(): Promise<number> {
    if (Date.now() - this.version.checkedAt < 5 * 60_000) return this.version.at;
    this.version.checkedAt = Date.now();
    try {
      const at = await this.socrata.updatedAt(DATASETS.motusAuthHistory);
      if (at) this.version.at = at;
    } catch {
      // keep the last known version
    }
    return this.version.at;
  }

  private remember(key: string, d: SavedDay) {
    this.days.delete(key);
    this.days.set(key, d);
    if (this.days.size > 4 * WARM_DAYS) this.days.delete(this.days.keys().next().value!);
  }

  /** One fetch per day at a time, however many visitors ask for it. */
  private refresh(date: string, kind: LeadKind, key: string): Promise<LeadsDay> {
    const running = this.inflight.get(key);
    if (running) return running;
    const p = (async () => {
      let data = await this.fetchNewOn(date, kind);
      const prev = this.days.get(key)?.data;
      // Census was down: keep the emails we already had for the same companies.
      if (data.partial && prev && !prev.partial) {
        const known = new Map(prev.carriers.map((c) => [c.mc, c]));
        data = { ...data, carriers: data.carriers.map((c) => known.get(c.mc) ?? c) };
      }
      this.remember(key, { fetchedAt: Date.now(), data });
      if (!data.partial) void this.leadsStore.put(key, data);
      return data;
    })().finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  /**
   * Keeps the last month of carrier and broker days current: after FMCSA's daily update every day is fetched
   * again, newest first, one at a time (gentle on FMCSA's rate limits), so visitors never wait for FMCSA.
   */
  private async warm() {
    const version = await this.dataVersion();
    if (version && version === this.warmedVersion) return;
    const order: [number, LeadKind][] = [];
    for (let back = 0; back < WARM_DAYS; back++) for (const kind of LEAD_KINDS) order.push([back, kind]);
    let failed = 0;
    const started = Date.now();
    for (const [back, kind] of order) {
      try {
        await this.day(easternDay(back), kind, true);
      } catch {
        failed++;
      }
    }
    if (!failed) this.warmedVersion = version;
    this.logger.log(`Leads warmed for FMCSA data of ${version ? new Date(version).toISOString() : 'unknown time'}: `
      + `${order.length - failed}/${order.length} days in ${Math.round((Date.now() - started) / 1000)}s`);
  }

  private async fetchNewOn(date: string, kind: LeadKind): Promise<LeadsDay> {
    const ymd = date.replace(/-/g, '');
    const grants = await this.socrata.query(DATASETS.motusAuthHistory, {
      $select: 'docket_number,usdot_number',
      $where: `upper(reason)='GRANTED' AND op_auth_status='Active' AND op_auth_type like '${AUTH_TYPE[kind]}'`
        + ` AND docket_number like 'MC%' AND status_change_date='${ymd}'`,
      $limit: '5000',
    });
    const mcByDot = new Map<string, number>();
    for (const g of grants) {
      const mc = docketToMc(g.docket_number ?? '');
      const dot = String(parseInt(g.usdot_number ?? '', 10));
      if (Number.isFinite(mc) && dot !== 'NaN') mcByDot.set(dot, mc);
    }

    // Phone and email come from the Company Census file. When FMCSA throttles or drops it (HTTP 429 for everyone
    // without an app token happens), fall back to the Motus registration file: name, phone and address, no email.
    let candidates: (Omit<Carrier, 'authority'>)[];
    let partial = false;
    try {
      if (Date.now() < this.censusDownUntil) throw new Error('Company Census is down');
      const census = (await Promise.all(chunks([...mcByDot.keys()]).map((dots) => this.socrata.query(DATASETS.census, {
        $select: CENSUS_FIELDS.join(','),
        $where: `dot_number in (${inList(dots)}) AND carship like '${CARSHIP[kind]}'`,
        $limit: '5000',
      })))).flat();
      candidates = census.flatMap((rec) => {
        const company = censusCompany(rec);
        const mc = mcByDot.get(String(parseInt(company.dot, 10)));
        return mc && (company.phone || company.email) ? [{ mc, ...company }] : [];
      });
    } catch {
      if (Date.now() >= this.censusDownUntil) this.censusDownUntil = Date.now() + 10 * 60_000;
      partial = true;
      candidates = (await this.motusContacts([...mcByDot.values()], kind)).filter((c) => c.phone);
    }

    const authority = new Map<number, Authority>();
    for (const part of chunks(candidates.map((c) => c.mc))) {
      for (const [mc, a] of await this.authorities(part, 'strict', kind)) authority.set(mc, a);
    }
    const carriers: Carrier[] = candidates.flatMap((c) => {
      const a = authority.get(c.mc);
      return a ? [{ ...c, authority: a, grantedOn: date }] : [];
    });
    carriers.sort((a, b) => a.legalName.localeCompare(b.legalName));
    return { date, granted: grants.length, carriers, ...(partial ? { partial } : {}) };
  }

  /** Name, phone and address from the Motus registration file (it has no email). */
  private async motusContacts(mcs: number[], kind: LeadKind): Promise<Omit<Carrier, 'authority'>[]> {
    const rows = (await Promise.all(chunks(mcs).map((part) => this.socrata.query(DATASETS.motusCarrier, {
      $select: 'docket_number,usdot_number,legal_name,bus_telno,bus_street_po,bus_city,bus_state_code,bus_zip_code,mail_street_po,mail_city,mail_state_code,mail_zip_code',
      $where: `docket_number in (${inList(docketVariants(part))}) AND op_auth_type like '${AUTH_TYPE[kind]}'`,
      $limit: '5000',
    })))).flat();
    const seen = new Set<number>();
    return rows.flatMap((r) => {
      const mc = docketToMc(r.docket_number ?? '');
      if (!Number.isFinite(mc) || seen.has(mc)) return [];
      seen.add(mc);
      const digits = (r.bus_telno ?? '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
      return [{
        mc, dot: String(parseInt(r.usdot_number ?? '', 10) || ''), legalName: r.legal_name ?? '', dbaName: '',
        phone: digits, cellPhone: '', fax: '', email: '', usdotStatus: '', entityTypes: kind === 'broker' ? 'B' : 'C', operation: '',
        state: r.bus_state_code ?? '', powerUnits: null, trucks: null, drivers: null, cdlDrivers: null, addedOn: null, officers: [],
        physicalAddress: joinAddress(r.bus_street_po, r.bus_city, r.bus_state_code, r.bus_zip_code),
        mailingAddress: joinAddress(r.mail_street_po, r.mail_city, r.mail_state_code, r.mail_zip_code),
        mcs150Date: null, mileage: null, mileageYear: '', safetyRating: 'Not rated', safetyRatingDate: null, hazmat: false, cargo: [],
      }];
    });
  }

  /** Authorized carriers (or brokers) with an email among MC from..to (inclusive). */
  async scan(from: number, to: number, mode: AuthorityMode, kind: LeadKind = 'carrier'): Promise<ScanResult> {
    const mcs = Array.from({ length: to - from + 1 }, (_, i) => from + i);
    const list = inList(mcs);
    const dockets = [1, 2, 3].map((i) => `(docket${i}prefix='MC' AND docket${i} in (${list}))`).join(' OR ');
    // Carriers (carship contains C) or brokers (B), email required.
    const census = await this.socrata.query(DATASETS.census, {
      $select: CENSUS_FIELDS.join(','),
      $where: `(${dockets}) AND email_address IS NOT NULL AND carship like '${CARSHIP[kind]}'`,
      $limit: '5000',
    });

    const wanted = new Set(mcs);
    const candidates = census.flatMap((rec) => censusToCarriers(rec, wanted));
    const authority = candidates.length ? await this.authorities(candidates.map((c) => c.mc), mode, kind) : new Map();
    const carriers = candidates.flatMap((c) => {
      const a = authority.get(c.mc);
      return a ? [{ ...c, authority: a }] : [];
    });
    carriers.sort((a, b) => a.mc - b.mc);
    return { from, to, censusRecords: census.length, carriers };
  }

  /** Authority per MC from the legacy L&I and Motus files; MCs the mode rejects are left out. */
  async authorities(mcList: number[], mode: AuthorityMode, kind: LeadKind = 'carrier'): Promise<Map<number, Authority>> {
    const mcs = [...new Set(mcList)];
    // Either system may be missing (the legacy L&I file is frozen since 05/2026 and may be retired):
    // work with whatever answers, fail only when neither does.
    const [legacyRes, motusRes] = await Promise.allSettled([
      this.socrata.query(DATASETS.legacyCarrier, {
        $select: LEGACY_FIELDS.join(','),
        $where: `docket_number in (${inList(mcs.map(legacyDocket))})`,
        $limit: '5000',
      }),
      this.socrata.query(DATASETS.motusCarrier, {
        $select: MOTUS_FIELDS.join(','),
        $where: `docket_number in (${inList(docketVariants(mcs))})`,
        $limit: '5000',
      }),
    ]);
    if (legacyRes.status === 'rejected' && motusRes.status === 'rejected') throw motusRes.reason;
    const legacyRows = legacyRes.status === 'fulfilled' ? legacyRes.value : [];
    const motusRows = motusRes.status === 'fulfilled' ? motusRes.value : [];
    const legacy = new Map(legacyRows.map((row) => [docketToMc(row.docket_number ?? ''), row]));
    const motus = summarizeMotus(motusRows);

    const out = new Map<number, Authority>();
    for (const mc of mcs) {
      const authority = buildAuthority(legacy.get(mc), motus.get(mc), mode, kind);
      if (authority) out.set(mc, authority);
    }
    return out;
  }
}
