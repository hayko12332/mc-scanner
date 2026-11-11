import { Injectable } from '@nestjs/common';
import { buildAuthority, LEGACY_FIELDS, MOTUS_FIELDS, summarizeMotus, type AuthorityMode } from './authority.mapper.js';
import { CENSUS_FIELDS, censusCompany, censusToCarriers } from './census.mapper.js';
import type { Authority, Carrier, LeadsDay, ScanResult } from './fmcsa.types.js';
import { docketToMc, docketVariants, joinAddress, legacyDocket } from './normalize.js';
import { LeadsStore } from './leads.store.js';
import { DATASETS, inList, SocrataClient } from './socrata.client.js';

/** Keeps Socrata URLs short: IN lists are split into chunks of this many values. */
const CHUNK = 150;
const chunks = <T>(items: T[], size = CHUNK) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

@Injectable()
export class CarriersService {
  /** New-carrier days are fetched once per window and reused (the FMCSA files update daily). */
  private readonly leadsCache = new Map<string, { at: number; result: Promise<LeadsDay> }>();

  private readonly leadsStore = new LeadsStore();
  /** While the Company Census file is failing, skip it (and its slow retries) until this time. */
  private censusDownUntil = 0;

  constructor(private readonly socrata: SocrataClient) {}

  /**
   * "New MC leads": property carriers whose authority was granted on `date` (YYYY-MM-DD), with a phone or email,
   * still active today. Since mid-2026 new MC numbers are random 8-digit dockets, so they are found by grant date
   * (Motus authority history) rather than by walking MC numbers.
   */
  newOn(date: string): Promise<LeadsDay> {
    const recent = Date.now() - Date.parse(date) < 2 * 86_400_000;
    const ttl = recent ? 30 * 60_000 : 6 * 3_600_000;
    const hit = this.leadsCache.get(date);
    if (hit && Date.now() - hit.at < ttl) return hit.result;
    const result = this.loadDay(date, ttl, hit?.result);
    this.leadsCache.set(date, { at: Date.now(), result });
    result.then((d) => {
      // Retry a partial day (contact file was down) after 10 minutes instead of waiting for the full TTL.
      if (d.partial) this.leadsCache.set(date, { at: Date.now() - ttl + 10 * 60_000, result });
    }, () => this.leadsCache.delete(date));
    if (this.leadsCache.size > 200) this.leadsCache.delete(this.leadsCache.keys().next().value!);
    return result;
  }

  /**
   * Fresh data from FMCSA when the saved copy is older than `ttl`; when FMCSA fails (outage, HTTP 429 rate limit)
   * the last good copy — in memory or in the database — is served instead of an error.
   */
  private async loadDay(date: string, ttl: number, previous?: Promise<LeadsDay>): Promise<LeadsDay> {
    const saved = await this.leadsStore.get(date);
    if (saved && Date.now() - saved.fetchedAt < ttl) return saved.data;
    try {
      const fresh = await this.fetchNewOn(date);
      // A partial day (no emails) never replaces a full saved copy, and is not saved itself.
      if (fresh.partial) return saved && !saved.data.partial ? saved.data : fresh;
      void this.leadsStore.put(date, fresh);
      return fresh;
    } catch (e) {
      const stale = saved?.data ?? (previous ? await previous.catch(() => null) : null);
      if (stale) return stale;
      throw e;
    }
  }

  private async fetchNewOn(date: string): Promise<LeadsDay> {
    const ymd = date.replace(/-/g, '');
    const grants = await this.socrata.query(DATASETS.motusAuthHistory, {
      $select: 'docket_number,usdot_number',
      $where: `upper(reason)='GRANTED' AND op_auth_status='Active' AND op_auth_type like 'Motor Carrier of Property%'`
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
        $where: `dot_number in (${inList(dots)}) AND carship like '%C%'`,
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
      candidates = (await this.motusContacts([...mcByDot.values()])).filter((c) => c.phone);
    }

    const authority = new Map<number, Authority>();
    for (const part of chunks(candidates.map((c) => c.mc))) {
      for (const [mc, a] of await this.authorities(part, 'strict')) authority.set(mc, a);
    }
    const carriers: Carrier[] = candidates.flatMap((c) => {
      const a = authority.get(c.mc);
      return a ? [{ ...c, authority: a, grantedOn: date }] : [];
    });
    carriers.sort((a, b) => a.legalName.localeCompare(b.legalName));
    return { date, granted: grants.length, carriers, ...(partial ? { partial } : {}) };
  }

  /** Name, phone and address of property carriers from the Motus registration file (it has no email). */
  private async motusContacts(mcs: number[]): Promise<Omit<Carrier, 'authority'>[]> {
    const rows = (await Promise.all(chunks(mcs).map((part) => this.socrata.query(DATASETS.motusCarrier, {
      $select: 'docket_number,usdot_number,legal_name,bus_telno,bus_street_po,bus_city,bus_state_code,bus_zip_code,mail_street_po,mail_city,mail_state_code,mail_zip_code',
      $where: `docket_number in (${inList(docketVariants(part))}) AND op_auth_type like 'Motor Carrier of Property%'`,
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
        phone: digits, cellPhone: '', fax: '', email: '', usdotStatus: '', entityTypes: 'C', operation: '',
        state: r.bus_state_code ?? '', powerUnits: null, trucks: null, drivers: null, cdlDrivers: null, addedOn: null, officers: [],
        physicalAddress: joinAddress(r.bus_street_po, r.bus_city, r.bus_state_code, r.bus_zip_code),
        mailingAddress: joinAddress(r.mail_street_po, r.mail_city, r.mail_state_code, r.mail_zip_code),
        mcs150Date: null, mileage: null, mileageYear: '', safetyRating: 'Not rated', safetyRatingDate: null, hazmat: false, cargo: [],
      }];
    });
  }

  /** Authorized carriers with an email among MC from..to (inclusive). */
  async scan(from: number, to: number, mode: AuthorityMode): Promise<ScanResult> {
    const mcs = Array.from({ length: to - from + 1 }, (_, i) => from + i);
    const list = inList(mcs);
    const dockets = [1, 2, 3].map((i) => `(docket${i}prefix='MC' AND docket${i} in (${list}))`).join(' OR ');
    // Carriers only (carship contains C), email required.
    const census = await this.socrata.query(DATASETS.census, {
      $select: CENSUS_FIELDS.join(','),
      $where: `(${dockets}) AND email_address IS NOT NULL AND carship like '%C%'`,
      $limit: '5000',
    });

    const wanted = new Set(mcs);
    const candidates = census.flatMap((rec) => censusToCarriers(rec, wanted));
    const authority = candidates.length ? await this.authorities(candidates.map((c) => c.mc), mode) : new Map();
    const carriers = candidates.flatMap((c) => {
      const a = authority.get(c.mc);
      return a ? [{ ...c, authority: a }] : [];
    });
    carriers.sort((a, b) => a.mc - b.mc);
    return { from, to, censusRecords: census.length, carriers };
  }

  /** Authority per MC from the legacy L&I and Motus files; MCs the mode rejects are left out. */
  async authorities(mcList: number[], mode: AuthorityMode): Promise<Map<number, Authority>> {
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
      const authority = buildAuthority(legacy.get(mc), motus.get(mc), mode);
      if (authority) out.set(mc, authority);
    }
    return out;
  }
}
