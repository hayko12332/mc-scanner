import { Injectable } from '@nestjs/common';
import { CarriersService } from './carriers.service.js';
import { CENSUS_FIELDS, censusCompany, mcDockets } from './census.mapper.js';
import type { CarrierProfile, LookupKind, LookupResult } from './fmcsa.types.js';
import type { ParsedQuery } from './lookup.query.js';
import { DATASETS, soqlString, SocrataClient } from './socrata.client.js';

/** A phone or email can be shared by many companies; that alone is worth knowing, but cap the list. */
const MAX_PROFILES = 25;

function censusWhere(kind: LookupKind, value: string): string {
  switch (kind) {
    case 'mc':
      return [1, 2, 3].map((i) => `(docket${i}prefix='MC' AND docket${i}=${soqlString(value)})`).join(' OR ');
    case 'dot':
      return `dot_number=${parseInt(value, 10)}`;
    case 'email':
      return `upper(email_address)=${soqlString(value)}`;
    case 'phone':
      return `phone=${soqlString(value)} OR cell_phone=${soqlString(value)}`;
  }
}

@Injectable()
export class LookupService {
  constructor(
    private readonly socrata: SocrataClient,
    private readonly carriers: CarriersService,
  ) {}

  /** Every census record matching the query, any entity type and status, with its authority when it has one. */
  async lookup(raw: string, query: ParsedQuery): Promise<LookupResult> {
    const census = await this.socrata.query(DATASETS.census, {
      $select: CENSUS_FIELDS.join(','),
      $where: query.kinds.map((k) => `(${censusWhere(k, query.value)})`).join(' OR '),
      $order: 'dot_number',
      $limit: String(MAX_PROFILES + 1),
    });
    const records = census.slice(0, MAX_PROFILES);
    const searchedMc = query.kinds.includes('mc') ? parseInt(query.value, 10) : null;

    const profiles: Omit<CarrierProfile, 'authority'>[] = records.map((rec) => {
      const mcNumbers = mcDockets(rec);
      const mc = searchedMc != null && mcNumbers.includes(searchedMc) ? searchedMc : (mcNumbers[0] ?? null);
      return { ...censusCompany(rec), mc, mcNumbers };
    });
    const mcs = profiles.map((p) => p.mc).filter((mc): mc is number => mc != null);
    const authority = mcs.length ? await this.carriers.authorities(mcs, 'any') : new Map();

    return {
      query: raw.trim(),
      kinds: query.kinds,
      truncated: census.length > MAX_PROFILES,
      profiles: profiles.map((p) => ({ ...p, authority: (p.mc != null && authority.get(p.mc)) || null })),
    };
  }
}
