import type { Carrier } from './fmcsa.types.js';
import { toIsoDate, toNumber } from './normalize.js';
import type { Row } from './socrata.client.js';

const CARGO: Record<string, string> = {
  genfreight: 'General Freight',
  household: 'Household Goods',
  metalsheet: 'Metal: sheets, coils, rolls',
  motoveh: 'Motor Vehicles',
  drivetow: 'Drive/Tow away',
  logpole: 'Logs, Poles, Beams, Lumber',
  bldgmat: 'Building Materials',
  mobilehome: 'Mobile Homes',
  machlrg: 'Machinery, Large Objects',
  produce: 'Fresh Produce',
  liqgas: 'Liquids/Gases',
  intermodal: 'Intermodal Cont.',
  passengers: 'Passengers',
  oilfield: 'Oilfield Equipment',
  livestock: 'Livestock',
  grainfeed: 'Grain, Feed, Hay',
  coalcoke: 'Coal/Coke',
  meat: 'Meat',
  garbage: 'Garbage/Refuse',
  usmail: 'US Mail',
  chem: 'Chemicals',
  drybulk: 'Commodities Dry Bulk',
  coldfood: 'Refrigerated Food',
  beverages: 'Beverages',
  paperprod: 'Paper Products',
  utility: 'Utilities',
  farmsupp: 'Agricultural/Farm Supplies',
  construct: 'Construction',
  waterwell: 'Water Well',
  cargoothr: 'Other',
};
const OPERATION: Record<string, string> = { A: 'Interstate', B: 'Intrastate Hazmat', C: 'Intrastate Non-Hazmat' };
const SAFETY_RATING: Record<string, string> = { S: 'Satisfactory', C: 'Conditional', U: 'Unsatisfactory' };

export const CENSUS_FIELDS = [
  'dot_number', 'legal_name', 'dba_name', 'phone', 'cell_phone', 'fax', 'email_address', 'status_code', 'carship',
  'carrier_operation', 'company_officer_1', 'company_officer_2', 'phy_street', 'phy_city', 'phy_state', 'phy_zip',
  'carrier_mailing_street', 'carrier_mailing_city', 'carrier_mailing_state', 'carrier_mailing_zip',
  'power_units', 'truck_units', 'total_drivers', 'total_cdl', 'mcs150_date', 'mcs150_mileage', 'mcs150_mileage_year',
  'add_date', 'safety_rating', 'safety_rating_date', 'hm_ind', 'crgo_cargoothr_desc',
  ...Object.keys(CARGO).map((k) => 'crgo_' + k),
  'docket1prefix', 'docket1', 'docket2prefix', 'docket2', 'docket3prefix', 'docket3',
];

const joinAddress = (street?: string, city?: string, state?: string, zip?: string) =>
  [street, city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');

/** One census record -> one carrier per requested MC it carries (a record has up to 3 dockets). */
export function censusToCarriers(rec: Row, wanted: Set<number>): Omit<Carrier, 'authority'>[] {
  const email = (rec.email_address ?? '').trim().toLowerCase();
  if (!email) return [];
  const out: Omit<Carrier, 'authority'>[] = [];
  for (const i of [1, 2, 3]) {
    if (rec[`docket${i}prefix`] !== 'MC') continue;
    const mc = parseInt(rec[`docket${i}`] ?? '', 10);
    if (!wanted.has(mc)) continue;
    out.push({
      mc,
      dot: rec.dot_number ?? '',
      legalName: rec.legal_name ?? '',
      dbaName: rec.dba_name ?? '',
      phone: rec.phone ?? '',
      cellPhone: rec.cell_phone ?? '',
      fax: rec.fax ?? '',
      email,
      usdotStatus: rec.status_code ?? '',
      entityTypes: rec.carship ?? '',
      operation: OPERATION[rec.carrier_operation ?? ''] ?? rec.carrier_operation ?? '',
      state: rec.phy_state ?? '',
      powerUnits: toNumber(rec.power_units),
      trucks: toNumber(rec.truck_units),
      drivers: toNumber(rec.total_drivers),
      cdlDrivers: toNumber(rec.total_cdl),
      addedOn: toIsoDate(rec.add_date),
      officers: [rec.company_officer_1, rec.company_officer_2].filter((o): o is string => !!o),
      physicalAddress: joinAddress(rec.phy_street, rec.phy_city, rec.phy_state, rec.phy_zip),
      mailingAddress: joinAddress(
        rec.carrier_mailing_street, rec.carrier_mailing_city, rec.carrier_mailing_state, rec.carrier_mailing_zip,
      ),
      mcs150Date: toIsoDate(rec.mcs150_date),
      mileage: toNumber(rec.mcs150_mileage) || null,
      mileageYear: rec.mcs150_mileage_year ?? '',
      safetyRating: SAFETY_RATING[rec.safety_rating ?? ''] ?? 'Not rated',
      safetyRatingDate: toIsoDate(rec.safety_rating_date),
      hazmat: rec.hm_ind === 'Y',
      cargo: Object.keys(CARGO)
        .filter((k) => rec['crgo_' + k] === 'X')
        .map((k) => (k === 'cargoothr' && rec.crgo_cargoothr_desc ? `Other: ${rec.crgo_cargoothr_desc}` : CARGO[k])),
    });
  }
  return out;
}
