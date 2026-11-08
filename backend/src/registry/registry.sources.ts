import { joinAddress, toIsoDate } from '../fmcsa/normalize.js';
import type { StateEntity } from './registry.types.js';

type Row = Record<string, unknown>;
type Entity = Omit<StateEntity, 'exact'>;

/** A state business registry published as Socrata open data. */
export interface RegistrySource {
  label: string;
  host: string;
  dataset: string;
  nameField: string;
  /** Rows to fetch; Oregon has one row per associated name, so it needs more. */
  limit: number;
  toEntities(rows: Row[]): Entity[];
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const date = (v: unknown) => {
  const d = toIsoDate(str(v));
  return d && !d.startsWith('0001') ? d : null;
};
const person = (...parts: unknown[]) => parts.map(str).filter(Boolean).join(' ');
const labelled = (label: string, name: string) => (name ? `${label}: ${name}` : '');
const entity = (e: Partial<Entity> & Pick<Entity, 'name'>): Entity => ({
  id: '', status: '', active: null, type: '', formed: null, address: '', email: '', detailsUrl: '', ...e,
  people: (e.people ?? []).filter(Boolean),
});

function coloradoActive(status: string): boolean | null {
  if (/good standing|exists/i.test(status)) return true;
  if (/dissolved|withdrawn|delinquent|revoked|expired|converted|merged/i.test(status)) return false;
  return null;
}

export const REGISTRY_SOURCES: Record<string, RegistrySource> = {
  NY: {
    label: 'New York Department of State — Active Corporations (data.ny.gov)',
    host: 'data.ny.gov',
    dataset: 'n9v6-gdp6',
    nameField: 'current_entity_name',
    limit: 20,
    // The dataset lists active entities only.
    toEntities: (rows) => rows.map((r) => entity({
      name: str(r.current_entity_name),
      id: `DOS ID ${str(r.dos_id)}`,
      status: 'Active',
      active: true,
      type: str(r.entity_type),
      formed: date(r.initial_dos_filing_date),
      address: str(r.location_address_1)
        ? joinAddress(str(r.location_address_1), str(r.location_city), str(r.location_state), str(r.location_zip))
        : joinAddress(str(r.dos_process_address_1), str(r.dos_process_city), str(r.dos_process_state), str(r.dos_process_zip)),
      people: [
        labelled('Chairman / CEO', str(r.chairman_name)),
        labelled('Registered agent', str(r.registered_agent_name)),
        labelled('Service of process', str(r.dos_process_name)),
      ],
    })),
  },
  CO: {
    label: 'Colorado Secretary of State — Business Entities (data.colorado.gov)',
    host: 'data.colorado.gov',
    dataset: '4ykn-tg5h',
    nameField: 'entityname',
    limit: 20,
    toEntities: (rows) => rows.map((r) => entity({
      name: str(r.entityname),
      id: `ID ${str(r.entityid)}`,
      status: str(r.entitystatus),
      active: coloradoActive(str(r.entitystatus)),
      type: [str(r.entitytype), str(r.jurisdictonofformation) && `formed in ${str(r.jurisdictonofformation)}`]
        .filter(Boolean).join(', '),
      formed: date(r.entityformdate),
      address: joinAddress(str(r.principaladdress1), str(r.principalcity), str(r.principalstate), str(r.principalzipcode)),
      people: [labelled('Registered agent',
        str(r.agentorganizationname) || person(r.agentfirstname, r.agentmiddlename, r.agentlastname, r.agentsuffix))],
    })),
  },
  TX: {
    label: 'Texas Comptroller — Active Franchise Taxpayers, incl. Secretary of State status (data.texas.gov)',
    host: 'data.texas.gov',
    dataset: '9cir-efmm',
    nameField: 'taxpayer_name',
    limit: 20,
    toEntities: (rows) => rows.map((r) => {
      const sos = str(r.sos_status_code);
      const transact = str(r.right_to_transact_business_code);
      return entity({
        name: str(r.taxpayer_name),
        id: [`Taxpayer ${str(r.taxpayer_number)}`, str(r.secretary_of_state_sos_or_coa_file_number) &&
          `SOS file ${str(r.secretary_of_state_sos_or_coa_file_number)}`].filter(Boolean).join(', '),
        status: [
          sos === 'A' ? 'Active' : sos === 'F' ? 'Forfeited' : sos ? `SOS status ${sos}` : '',
          transact === 'A' ? 'right to transact business' : transact === 'N' ? 'no right to transact business' : '',
        ].filter(Boolean).join(', '),
        active: sos === 'F' || transact === 'N' ? false : sos === 'A' && transact === 'A' ? true : null,
        formed: date(r.sos_charter_date) ?? date(r.responsibility_beginning_date),
        address: joinAddress(str(r.taxpayer_address), str(r.taxpayer_city), str(r.taxpayer_state), str(r.taxpayer_zip)),
      });
    }),
  },
  OR: {
    label: 'Oregon Secretary of State — Active Businesses (data.oregon.gov)',
    host: 'data.oregon.gov',
    dataset: 'tckn-sxa6',
    nameField: 'business_name',
    limit: 80,
    // One row per associated name (principal place, registered agent, ...); group them by registry number.
    toEntities: (rows) => {
      const byId = new Map<string, Row[]>();
      for (const r of rows) byId.set(str(r.registry_number), [...(byId.get(str(r.registry_number)) ?? []), r]);
      return [...byId.entries()].map(([id, group]) => {
        const first = group[0];
        const place = group.find((r) => str(r.associated_name_type) === 'PRINCIPAL PLACE OF BUSINESS') ?? first;
        const details = first.business_details as { url?: string } | undefined;
        return entity({
          name: str(first.business_name),
          id: `Registry ${id}`,
          status: 'Active',
          active: true,
          type: str(first.entity_type),
          formed: date(first.registry_date),
          address: joinAddress(person(place.address, place.address_continued), str(place.city), str(place.state), str(place.zip)),
          people: group
            .filter((r) => !/ADDRESS|PLACE OF BUSINESS/.test(str(r.associated_name_type)))
            .map((r) => labelled(
              str(r.associated_name_type).toLowerCase().replace(/^\w/, (c) => c.toUpperCase()),
              str(r.entity_of_record_name) || person(r.first_name, r.middle_name, r.last_name, r.suffix),
            )),
          detailsUrl: details?.url ?? '',
        });
      });
    },
  },
  CT: {
    label: 'Connecticut Secretary of the State — Business Registry (data.ct.gov)',
    host: 'data.ct.gov',
    dataset: 'n7gp-d28j',
    nameField: 'name',
    limit: 20,
    toEntities: (rows) => rows.map((r) => {
      const status = [str(r.status), str(r.sub_status)].filter(Boolean).join(' — ');
      return entity({
        name: str(r.name),
        id: `Account ${str(r.accountnumber)}`,
        status,
        active: /^active/i.test(str(r.status)) ? true : str(r.status) ? false : null,
        type: str(r.business_type),
        formed: date(r.date_registration),
        address: joinAddress(str(r.billingstreet), str(r.billingcity), str(r.billingstate), str(r.billingpostalcode)),
        email: str(r.business_email_address).toLowerCase(),
      });
    }),
  },
};
