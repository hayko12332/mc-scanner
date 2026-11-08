/** A business entity in a state's corporate registry. */
export interface StateEntity {
  name: string;
  /** Registry id, e.g. NY DOS ID or TX taxpayer number. */
  id: string;
  status: string;
  /** true = active / in good standing, false = dissolved, forfeited etc., null = unknown. */
  active: boolean | null;
  type: string;
  formed: string | null;
  address: string;
  /** Registered agent, officers, service-of-process contact. */
  people: string[];
  email: string;
  detailsUrl: string;
  /** Name equals the searched name, ignoring punctuation and case. */
  exact: boolean;
}

export interface RegistryResult {
  state: string;
  name: string;
  /** False when the state publishes no free registry data we can query; use the state's own search. */
  supported: boolean;
  source: string;
  truncated: boolean;
  entities: StateEntity[];
}
