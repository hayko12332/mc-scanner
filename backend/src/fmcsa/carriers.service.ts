import { Injectable } from '@nestjs/common';
import { buildAuthority, LEGACY_FIELDS, MOTUS_FIELDS, summarizeMotus, type AuthorityMode } from './authority.mapper.js';
import { CENSUS_FIELDS, censusToCarriers } from './census.mapper.js';
import type { Carrier, ScanResult } from './fmcsa.types.js';
import { docketToMc, docketVariants, legacyDocket } from './normalize.js';
import { DATASETS, inList, SocrataClient } from './socrata.client.js';

@Injectable()
export class CarriersService {
  constructor(private readonly socrata: SocrataClient) {}

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
    const carriers = candidates.length ? await this.withAuthority(candidates, mode) : [];
    carriers.sort((a, b) => a.mc - b.mc);
    return { from, to, censusRecords: census.length, carriers };
  }

  private async withAuthority(candidates: Omit<Carrier, 'authority'>[], mode: AuthorityMode): Promise<Carrier[]> {
    const mcs = [...new Set(candidates.map((c) => c.mc))];
    const [legacyRows, motusRows] = await Promise.all([
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
    const legacy = new Map(legacyRows.map((row) => [docketToMc(row.docket_number ?? ''), row]));
    const motus = summarizeMotus(motusRows);

    return candidates.flatMap((c) => {
      const authority = buildAuthority(legacy.get(c.mc), motus.get(c.mc), mode);
      return authority ? [{ ...c, authority }] : [];
    });
  }
}
