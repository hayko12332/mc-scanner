/** Authority status code used by the FMCSA files: Active, Inactive, Pending, None. */
export type AuthorityCode = 'A' | 'I' | 'P' | 'N';
export type YesNo = 'Y' | 'N' | '';
export type AuthoritySource = 'L&I' | 'Motus';

export interface Authority {
  sources: AuthoritySource[];
  /** Legacy L&I common / contract / broker authority (derived from Motus when L&I has no record). */
  common: AuthorityCode;
  contract: AuthorityCode;
  broker: AuthorityCode;
  /** Carrier authority in Motus (the current FMCSA system), null if Motus has no carrier record. */
  motusCarrier: AuthorityCode | null;
  motusAuthorities: string[];
  pendingApplications: string[];
  pendingRevocations: string[];
  authorityTypes: string[];
  bipdRequired: number | null;
  bipdOnFile: number | null;
  cargoRequired: YesNo;
  cargoOnFile: YesNo;
  bondRequired: YesNo;
  bondOnFile: YesNo;
}

export interface Carrier {
  mc: number;
  dot: string;
  legalName: string;
  dbaName: string;
  phone: string;
  cellPhone: string;
  fax: string;
  email: string;
  /** USDOT status from the census file: 'A' active, 'I' inactive. */
  usdotStatus: string;
  /** Census entity codes, e.g. "C;B" = carrier + broker. */
  entityTypes: string;
  operation: string;
  state: string;
  powerUnits: number | null;
  trucks: number | null;
  drivers: number | null;
  cdlDrivers: number | null;
  addedOn: string | null;
  officers: string[];
  physicalAddress: string;
  mailingAddress: string;
  mcs150Date: string | null;
  mileage: number | null;
  mileageYear: string;
  safetyRating: string;
  safetyRatingDate: string | null;
  hazmat: boolean;
  cargo: string[];
  authority: Authority;
}

export interface ScanResult {
  from: number;
  to: number;
  /** Raw census matches before filtering; 0 for a long run means the end of the MC range. */
  censusRecords: number;
  carriers: Carrier[];
}

export interface Policy {
  type: string;
  company: string;
  policyNumber: string;
  amount: number | null;
  underlying: number | null;
  effectiveDate: string | null;
  cancelledDate: string | null;
  postedDate: string | null;
  /** Why a past policy ended (CANCEL, TERM/REPL, ...). */
  reason: string;
}

export interface Insurance {
  /** Motus = current FMCSA system; L&I = legacy file with no new filings since 05/2026. */
  source: AuthoritySource;
  current: Policy[];
  past: Policy[];
}
