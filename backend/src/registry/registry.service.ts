import { Injectable } from '@nestjs/common';
import { soqlString, SocrataClient } from '../fmcsa/socrata.client.js';
import { normalizeName, searchPrefix } from './registry.names.js';
import { REGISTRY_SOURCES } from './registry.sources.js';
import type { RegistryResult } from './registry.types.js';

const MAX_ENTITIES = 10;

@Injectable()
export class RegistryService {
  constructor(private readonly socrata: SocrataClient) {}

  /** Search a state's business registry by company name; exact name matches first. */
  async search(state: string, name: string): Promise<RegistryResult> {
    const source = REGISTRY_SOURCES[state];
    if (!source) return { state, name, supported: false, source: '', truncated: false, entities: [] };

    const rows = await this.socrata.query<Record<string, unknown>>(source.dataset, {
      $where: `upper(${source.nameField}) like ${soqlString(searchPrefix(name) + '%')}`,
      $order: source.nameField,
      $limit: String(source.limit),
    }, source.host);

    const wanted = normalizeName(name);
    const entities = source
      .toEntities(rows)
      .map((e) => ({ ...e, exact: normalizeName(e.name) === wanted }))
      .sort((a, b) => Number(b.exact) - Number(a.exact));
    return {
      state,
      name,
      supported: true,
      source: source.label,
      truncated: entities.length > MAX_ENTITIES || rows.length >= source.limit,
      entities: entities.slice(0, MAX_ENTITIES),
    };
  }
}
