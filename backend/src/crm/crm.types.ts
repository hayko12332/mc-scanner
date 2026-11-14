/** Dispatcher CRM: a workspace (one per user for now) with its dispatchers, carriers and loads. */

export interface CrmUser {
  id: number;
  email: string;
  name: string;
  picture: string;
}

export interface Dispatcher {
  id: number;
  name: string;
  /** Share of the load rate the dispatcher earns, in percent (e.g. 5 = 5%). */
  percent: number;
}

/** How a dispatch service charges a carrier: a percent of each load's gross, or a flat amount per week. */
export const FEE_TYPES = ['percent', 'flat'] as const;
export type FeeType = (typeof FEE_TYPES)[number];

export interface CrmCarrier {
  id: number;
  name: string;
  mc: string;
  dot: string;
  phone: string;
  email: string;
  notes: string;
  feeType: FeeType;
  /** Percent (e.g. 8 = 8% of gross) or dollars per week, depending on feeType. */
  fee: number;
  /** Factoring company the carrier uses, if any. */
  factoring: string;
}

/** A truck (and its driver) of a carrier. */
export interface Truck {
  id: number;
  carrierId: number | null;
  /** Unit / truck number. */
  unit: string;
  driver: string;
  phone: string;
}

/** Where a load is: booked → in transit → delivered → invoiced → paid. */
export const LOAD_STATUSES = ['booked', 'in_transit', 'delivered', 'invoiced', 'paid'] as const;
export type LoadStatus = (typeof LOAD_STATUSES)[number];

export interface Load {
  id: number;
  /** YYYY-MM-DD */
  date: string;
  carrierId: number | null;
  dispatcherId: number | null;
  broker: string;
  /** PRO / load number. */
  pro: string;
  origin: string;
  destination: string;
  /** Linehaul rate from the rate confirmation. */
  rate: number;
  notes: string;
  status: LoadStatus;
  truckId: number | null;
  loadedMiles: number;
  /** Deadhead: empty miles to the pickup. */
  emptyMiles: number;
  // Accessorials added to the rate. Lumper is a reimbursement and is not part of gross.
  detention: number;
  layover: number;
  tonu: number;
  other: number;
  lumper: number;
  /** YYYY-MM-DD the broker was invoiced; payment terms count from here. */
  invoicedOn: string | null;
  /** YYYY-MM-DD the broker paid. */
  paidOn: string | null;
}

/** Who uses the workspace: asked at sign-up, like other TMSs do, to set the board up for the business. */
export type CompanyType = 'dispatch' | 'carrier' | 'broker' | '';
export interface CompanyInput { name: string; type: CompanyType | string; mc: string; dot: string; phone: string; fleetSize: string }

export interface CrmState {
  user: CrmUser;
  company: CompanyInput;
  dispatchers: Dispatcher[];
  carriers: CrmCarrier[];
  trucks: Truck[];
  loads: Load[];
}

/** A row pasted from a spreadsheet; dispatcher and carrier are names that are matched or created. */
export interface ImportRow {
  date: string;
  broker: string;
  pro: string;
  origin: string;
  destination: string;
  rate: number;
  dispatcher: string;
  carrier: string;
  loadedMiles: number;
}
