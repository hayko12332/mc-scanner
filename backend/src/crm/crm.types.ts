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

export interface CrmCarrier {
  id: number;
  name: string;
  mc: string;
  dot: string;
  phone: string;
  email: string;
  notes: string;
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
  rate: number;
  notes: string;
  status: LoadStatus;
}

export interface CrmState {
  user: CrmUser;
  dispatchers: Dispatcher[];
  carriers: CrmCarrier[];
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
}
