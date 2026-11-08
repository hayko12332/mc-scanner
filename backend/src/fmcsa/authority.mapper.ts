import type { Authority, AuthorityCode } from './fmcsa.types.js';
import { docketToMc, dollars, legacyDollars, yesNo } from './normalize.js';
import type { Row } from './socrata.client.js';

export const LEGACY_FIELDS = [
  'docket_number', 'common_stat', 'contract_stat', 'broker_stat', 'common_app_pend', 'contract_app_pend',
  'broker_app_pend', 'common_rev_pend', 'contract_rev_pend', 'broker_rev_pend', 'property_chk', 'passenger_chk',
  'hhg_chk', 'private_auth_chk', 'enterprise_chk', 'min_cov_amount', 'cargo_req', 'bond_req', 'bipd_file',
  'cargo_file', 'bond_file',
];
export const MOTUS_FIELDS = [
  'docket_number', 'op_auth_type', 'op_auth_status', 'min_cov_amount', 'bipd_file', 'cargo_req', 'cargo_file',
  'bond_req', 'bond_file',
];

/**
 * strict: skip a carrier if either system has a non-active carrier record (no SAFER check follows).
 * lenient: keep it if either system says active; SAFER makes the final call afterwards.
 * any: keep every MC that has an authority record (individual lookup shows inactive ones too).
 */
export type AuthorityMode = 'strict' | 'lenient' | 'any';

interface MotusSummary {
  carrier: AuthorityCode | null;
  broker: AuthorityCode | null;
  authorities: string[];
  /** Row of the best carrier authority, which carries the insurance-on-file values. */
  carrierRow: Row | null;
}

const code = (v: string | undefined): AuthorityCode => (v === 'A' || v === 'I' || v === 'P' ? v : 'N');
const motusCode = (status: string | undefined): AuthorityCode =>
  status === 'Active' ? 'A' : status === 'Pending' ? 'P' : 'I';
const rank = (c: AuthorityCode | null) => ({ A: 3, P: 2, I: 1, N: 0 })[c ?? 'N'];

export function summarizeMotus(rows: Row[]): Map<number, MotusSummary> {
  const byMc = new Map<number, MotusSummary>();
  for (const row of rows) {
    const mc = docketToMc(row.docket_number ?? '');
    const s = byMc.get(mc) ?? { carrier: null, broker: null, authorities: [], carrierRow: null };
    const status = motusCode(row.op_auth_status);
    const type = row.op_auth_type ?? '';
    s.authorities.push(`${type} — ${row.op_auth_status}`);
    if (/Broker|Freight Forwarder/i.test(type)) {
      if (/Broker/i.test(type) && rank(status) > rank(s.broker)) s.broker = status;
    } else if (/Motor Carrier/i.test(type) && rank(status) > rank(s.carrier)) {
      s.carrier = status;
      s.carrierRow = row;
    }
    byMc.set(mc, s);
  }
  return byMc;
}

/** Combine the legacy L&I and Motus records for one MC; null if the carrier is not authorized. */
export function buildAuthority(legacy: Row | undefined, motus: MotusSummary | undefined, mode: AuthorityMode): Authority | null {
  const legacyOk = legacy ? legacy.common_stat === 'A' || legacy.contract_stat === 'A' : null;
  const motusOk = motus?.carrier ? motus.carrier === 'A' : null;
  const keep =
    mode === 'any'
      ? !!(legacy || motus)
      : mode === 'lenient'
        ? legacyOk === true || motusOk === true
        : legacyOk !== false && motusOk !== false && (legacyOk != null || motusOk != null);
  if (!keep) return null;

  const pending = (suffix: 'app_pend' | 'rev_pend') =>
    legacy ? (['common', 'contract', 'broker'] as const).filter((k) => legacy[`${k}_${suffix}`] === 'Y') : [];
  // Motus is the current system, so its insurance-on-file values win when present.
  const motusRow = motus?.carrierRow;
  const onFile = motusRow ?? legacy ?? {};
  const legacyBroker = legacy ? code(legacy.broker_stat) : null;

  return {
    sources: [legacy && ('L&I' as const), motus && ('Motus' as const)].filter((s): s is 'L&I' | 'Motus' => !!s),
    common: legacy ? code(legacy.common_stat) : 'A',
    contract: legacy ? code(legacy.contract_stat) : 'N',
    broker: legacyBroker === 'A' || motus?.broker === 'A' ? 'A' : (legacyBroker ?? motus?.broker ?? 'N'),
    motusCarrier: motus?.carrier ?? null,
    motusAuthorities: motus?.authorities ?? [],
    pendingApplications: pending('app_pend'),
    pendingRevocations: pending('rev_pend'),
    authorityTypes: legacy
      ? [
          legacy.property_chk === 'Y' && 'Property',
          legacy.passenger_chk === 'Y' && 'Passenger',
          legacy.hhg_chk === 'Y' && 'Household Goods',
          legacy.private_auth_chk === 'Y' && 'Private',
          legacy.enterprise_chk === 'Y' && 'Enterprise',
        ].filter((t): t is string => !!t)
      : [],
    bipdRequired: motusRow ? dollars(motusRow.min_cov_amount) : legacyDollars(legacy?.min_cov_amount),
    bipdOnFile: motusRow ? dollars(motusRow.bipd_file) : legacyDollars(legacy?.bipd_file),
    cargoRequired: yesNo(onFile.cargo_req),
    cargoOnFile: yesNo(onFile.cargo_file),
    bondRequired: yesNo(onFile.bond_req),
    bondOnFile: yesNo(onFile.bond_file),
  };
}
