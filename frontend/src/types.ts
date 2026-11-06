// Mirrors the backend API contract (backend/src/fmcsa/fmcsa.types.ts, backend/src/safer/safer.parser.ts).

export type AuthorityCode = 'A' | 'I' | 'P' | 'N'
export type YesNo = 'Y' | 'N' | ''
export type AuthoritySource = 'L&I' | 'Motus'
export type AuthorityMode = 'strict' | 'lenient'

export interface Authority {
  sources: AuthoritySource[]
  common: AuthorityCode
  contract: AuthorityCode
  broker: AuthorityCode
  motusCarrier: AuthorityCode | null
  motusAuthorities: string[]
  pendingApplications: string[]
  pendingRevocations: string[]
  authorityTypes: string[]
  bipdRequired: number | null
  bipdOnFile: number | null
  cargoRequired: YesNo
  cargoOnFile: YesNo
  bondRequired: YesNo
  bondOnFile: YesNo
}

export interface Carrier {
  mc: number
  dot: string
  legalName: string
  dbaName: string
  phone: string
  cellPhone: string
  fax: string
  email: string
  usdotStatus: string
  entityTypes: string
  operation: string
  state: string
  powerUnits: number | null
  trucks: number | null
  drivers: number | null
  cdlDrivers: number | null
  addedOn: string | null
  officers: string[]
  physicalAddress: string
  mailingAddress: string
  mcs150Date: string | null
  mileage: number | null
  mileageYear: string
  safetyRating: string
  safetyRatingDate: string | null
  hazmat: boolean
  cargo: string[]
  authority: Authority
}

export interface ScanResult {
  from: number
  to: number
  censusRecords: number
  carriers: Carrier[]
}

export interface Policy {
  type: string
  company: string
  policyNumber: string
  amount: number | null
  underlying: number | null
  effectiveDate: string | null
  cancelledDate: string | null
  postedDate: string | null
  reason: string
}

export interface Insurance {
  source: AuthoritySource
  current: Policy[]
  past: Policy[]
}

export interface SaferRecord {
  found: true
  asOf: string
  entityType: string
  usdotStatus: string
  outOfServiceDate: string
  authorityStatus: string
  authorizedFor: string[]
  authorized: boolean
  broker: boolean
  dot: string
  mcNumbers: string[]
  legalName: string
  dbaName: string
  phone: string
  physicalAddress: string
  mailingAddress: string
  mcs150Date: string
  powerUnits: string
  drivers: string
}
export type SaferSnapshot = SaferRecord | { found: false }

/** A carrier kept by the scanner, with the live SAFER result when it was verified. */
export interface ScannedCarrier extends Carrier {
  safer?: SaferRecord & { checkedAt: string }
}
