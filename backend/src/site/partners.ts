// Services HaulPanel recommends to truckers, with referral links. Every link goes through /api/go/<id>, which counts
// the click and sends the person on — so a referral link can be swapped in (PARTNER_LINKS on the server, JSON
// {"otr":"https://…"}) without touching the pages. Until then the link is the partner's own site.

export type PartnerCategory = 'factoring' | 'loadboards' | 'eld' | 'fuel' | 'insurance' | 'business';

export interface Partner {
  id: string;
  name: string;
  category: PartnerCategory;
  /** The partner's own site (used until a referral link is set). */
  url: string;
  /** What it is, in one line — plain facts, no promised prices. */
  blurb: string;
  /** Who it helps most. */
  for: string;
}

export const PARTNER_CATEGORIES: { id: PartnerCategory; name: string; why: string }[] = [
  { id: 'factoring', name: 'Factoring', why: 'Get paid in a day instead of waiting 30+ days for brokers.' },
  { id: 'loadboards', name: 'Load boards', why: 'Find loads and check broker credit before you book.' },
  { id: 'eld', name: 'ELD & fleet', why: 'Hours of service, GPS and fleet data in one place.' },
  { id: 'fuel', name: 'Fuel cards', why: 'Discounts at the pump and control over every gallon.' },
  { id: 'insurance', name: 'Insurance', why: 'Coverage you need for your authority and your customers.' },
  { id: 'business', name: 'Start & run the business', why: 'LLC, registered agent and bookkeeping for new carriers and dispatchers.' },
];

export const PARTNERS: Partner[] = [
  { id: 'otr', name: 'OTR Solutions', category: 'factoring', url: 'https://otrsolutions.com', blurb: 'Freight factoring with fast funding, broker credit checks and fuel advances.', for: 'Owner-operators and small fleets' },
  { id: 'ecapital', name: 'eCapital', category: 'factoring', url: 'https://ecapital.com/transportation/', blurb: 'Freight factoring and financing for carriers and brokers of every size.', for: 'Carriers and freight brokers' },
  { id: 'bobtail', name: 'Bobtail', category: 'factoring', url: 'https://www.bobtail.com', blurb: 'Freight factoring for small carriers, with a program for dispatchers.', for: 'New authorities and dispatchers' },
  { id: 'truckstop', name: 'Truckstop', category: 'loadboards', url: 'https://truckstop.com', blurb: 'Load board with broker credit and days-to-pay, rate insights and truck posting.', for: 'Carriers, dispatchers and brokers' },
  { id: '123lb', name: '123Loadboard', category: 'loadboards', url: 'https://www.123loadboard.com', blurb: 'Affordable load board with load search, broker credit and mileage tools.', for: 'Owner-operators and dispatchers' },
  { id: 'dat', name: 'DAT', category: 'loadboards', url: 'https://www.dat.com', blurb: 'The largest load board in North America, with rate data by lane.', for: 'Carriers, dispatchers and brokers' },
  { id: 'motive', name: 'Motive', category: 'eld', url: 'https://gomotive.com', blurb: 'ELD, GPS tracking, dash cams and fleet management.', for: 'Fleets of every size' },
  { id: 'coast', name: 'Coast', category: 'fuel', url: 'https://coastpay.com', blurb: 'Fuel and fleet card with spending controls for each driver and truck.', for: 'Small and mid-size fleets' },
  { id: 'nextins', name: 'NEXT Insurance', category: 'insurance', url: 'https://www.nextinsurance.com', blurb: 'Business insurance bought online — general liability and more for small businesses.', for: 'Dispatch services and small businesses' },
  { id: 'zenbusiness', name: 'ZenBusiness', category: 'business', url: 'https://www.zenbusiness.com', blurb: 'Form an LLC online, with registered agent and compliance help.', for: 'New carriers and dispatch services' },
  { id: 'northwest', name: 'Northwest Registered Agent', category: 'business', url: 'https://www.northwestregisteredagent.com', blurb: 'LLC formation and registered agent service in every state.', for: 'New carriers and dispatch services' },
  { id: 'quickbooks', name: 'QuickBooks', category: 'business', url: 'https://quickbooks.intuit.com', blurb: 'Bookkeeping, invoices and taxes for small businesses — connects with HaulPanel.', for: 'Every trucking business' },
];

export const partner = (id: string) => PARTNERS.find((p) => p.id === id);

let overrides: Record<string, string> | null = null;
/** Referral links set on the server (PARTNER_LINKS), checked to be https. */
function links(): Record<string, string> {
  if (overrides) return overrides;
  try {
    const raw = JSON.parse(process.env.PARTNER_LINKS || '{}') as Record<string, unknown>;
    overrides = Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === 'string' && /^https:\/\//.test(v)) as [string, string][]);
  } catch { overrides = {}; }
  return overrides;
}
/** Tests reset the cached links. */
export const resetPartnerLinks = () => { overrides = null; };

/** Where a click on this partner goes: the referral link if set, else the partner's site. */
export function partnerTarget(id: string): string | null {
  const p = partner(id);
  if (!p) return null;
  return links()[id] ?? p.url;
}

/** Our own link for a partner (counts the click). `from` says which page it was on. */
export const goHref = (id: string, from: string) => `/api/go/${id}?from=${encodeURIComponent(from)}`;
