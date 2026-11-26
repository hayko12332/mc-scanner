import type { Comparison, Profile } from './partner-profiles.js';

// ELD (Motive), fuel & fleet card (Coast) and small-business insurance (NEXT) — facts from their own sites, checked
// 2026-11-26, including what each one is NOT for, so carriers don't pick the wrong product.

const UPDATED = '2026-11-26';

export const FLEET_PROFILES: Profile[] = [
  {
    id: 'motive', slug: 'motive-eld', updated: UPDATED,
    title: 'Motive ELD — Hours of Service, AI Dashcams, Fleet Tracking (2026)',
    description: 'Motive (formerly KeepTruckin) ELD and fleet platform: FMCSA-registered ELD with the Vehicle Gateway, HOS logs and alerts, IFTA, AI dashcams, GPS tracking, open API — and what to ask before you buy.',
    h1: 'Motive: ELD, dashcams and fleet management',
    lead: 'Motive (formerly KeepTruckin) makes an FMCSA-registered ELD — the Vehicle Gateway plus the Motive Driver App — and a fleet platform around it: AI dashcams, GPS tracking, IFTA, maintenance and a fleet card.',
    glance: [['Best for', 'Fleets of every size'], ['ELD', 'FMCSA-registered (per Motive)'], ['Hardware', 'Vehicle Gateway + Driver App'], ['Price', 'Not published — by quote'], ['IFTA & DVIR', 'Included in the app'], ['API', 'Open, free developer account'], ['Since', '2013']],
    features: [
      { h: 'ELD and hours of service', p: 'Driver logs, violation tracking, HOS countdown clocks and alerts, personal conveyance and yard move, US and Canada rule sets.' },
      { h: 'Vehicle Gateway', p: 'Plugs into the truck’s diagnostic port and pairs with the Motive Driver App; AI Dashcam Plus combines it with a dashcam in one unit.' },
      { h: 'AI dashcams', p: 'AI Dashcam, AI Dashcam Plus and AI Omnicam for side, rear, passenger and cargo views, with driver coaching.' },
      { h: 'GPS and asset tracking', p: 'Live fleet tracking, trailer and equipment trackers and reefer monitoring.' },
      { h: 'IFTA, DVIR, maintenance', p: 'Fuel tax reports, inspections and maintenance in the same platform.' },
      { h: 'Open API', p: 'A free developer account and webhooks for vehicles, HOS logs, locations and IFTA — and an App Marketplace with TMS apps.' },
    ],
    pricing: 'Motive does not publish prices, plan names or contract terms on its site — pricing comes from its sales team. Ask for a written quote that lists the hardware, the monthly cost per vehicle and the contract length.',
    signup: ['Contact Motive’s sales team from its Get in touch page.', 'Get a written quote: hardware, monthly cost per truck, contract length and what happens to the devices if you leave.', 'Install the Vehicle Gateway in each truck and have drivers log in to the Motive Driver App.'],
    withHaulPanel: 'Connect Motive to HaulPanel and your trucks show up on the fleet map with live location, speed and drivers’ hours left — and the AI assistant can answer “where is truck 101?” or “who has hours for a load tomorrow?”.',
    goodToKnow: ['Prices and contract terms aren’t on Motive’s site — get the quote in writing before you sign.', 'ELDs are self-certified and FMCSA can revoke them; check the live list at eld.fmcsa.dot.gov before you buy any ELD.', 'Motive sells a broad platform; if you only need HOS compliance, ask for the ELD alone.'],
    faq: [
      ['Is Motive an FMCSA-registered ELD?', 'Motive states its ELD is FMCSA-registered and on FMCSA’s list of self-certified ELDs. You can check the current entry at eld.fmcsa.dot.gov/List.'],
      ['What hardware does the Motive ELD use?', 'The Motive Vehicle Gateway, which connects to the truck’s diagnostic port and works with the Motive Driver App. AI Dashcam Plus combines the Gateway and a dashcam in one unit.'],
      ['How much does Motive cost?', 'Motive doesn’t publish prices; you get a quote from its sales team.'],
      ['Does Motive do IFTA?', 'Yes — IFTA fuel tax reporting is part of the platform, alongside HOS and DVIR.'],
      ['Can a TMS get data from Motive?', 'Yes. Motive has an open API with a free developer account and webhooks covering vehicles, HOS logs, locations and IFTA — and HaulPanel connects to it.'],
    ],
    sources: ['https://gomotive.com/', 'https://gomotive.com/products/fleet-compliance/eld-compliance/', 'https://gomotive.com/products/dashcam/', 'https://gomotive.com/blog/motive-eld-fmcsa-compliant/', 'https://developer.gomotive.com/', 'https://marketplace.gomotive.com/'],
  },
  {
    id: 'coast', slug: 'coast-fuel-card', updated: UPDATED,
    title: 'Coast Fuel & Fleet Card — $4 per User, Visa, Spending Controls (2026)',
    description: 'Coast Visa fleet card: $4 per active user a month, fuel discounts at partner stations, per-driver spending controls, receipt capture, QuickBooks and telematics integrations — and who it is (and isn’t) for.',
    h1: 'Coast: fuel and fleet card with spending controls',
    lead: 'Coast is a Visa commercial card for fuel and every other fleet expense, with limits per driver and vehicle, cards locked by default, fuel discounts at partner stations and receipts that code themselves.',
    glance: [['Best for', 'Local and regional fleets (LLCs, corporations)'], ['Price', '$4 per active user / month'], ['Fuel discount', '3–9¢/gal at partner stations'], ['Accepted', 'Wherever Visa is'], ['Personal guarantee', 'No'], ['Sole proprietors', 'Not approved'], ['Card', 'Visa, issued by Celtic Bank']],
    features: [
      { h: 'One card for fuel and expenses', p: 'Diesel, DEF, gas, repairs and supplies on one Visa card accepted wherever Visa is.' },
      { h: 'Controls per driver and truck', p: 'Cards locked by default; limits by driver, vehicle, merchant, day and time, with fraud blocking.' },
      { h: 'Fuel discounts', p: '3¢–9¢ per gallon at partner stations, and fuel routing to cheaper stations.' },
      { h: 'Fraud guarantee', p: 'Up to $25,000 a year in fuel fraud protection when the advanced security features are on.' },
      { h: 'Receipts and coding', p: 'Receipt capture, job tagging, approvals and automatic GL coding.' },
      { h: 'Integrations', p: 'QuickBooks, NetSuite, Sage Intacct, and telematics like Samsara, Geotab and Verizon Connect.' },
    ],
    pricing: 'From Coast’s pricing page on November 26, 2026: $4 per active user per month (a user with at least one transaction that month). Bill Pay is $99 a month. Late payments cost the greater of 2.5% or $35; foreign transactions 2.5%. It is a charge card: the balance is paid in full each statement.',
    plans: [{ name: 'Card', price: '$4', what: 'Per active user per month; card shipping free.' }, { name: 'Bill Pay', price: '$99/mo', what: 'Includes 100 ACH payments and 100 checks.' }, { name: 'Fuel discount', price: '3–9¢/gal', what: 'At Coast partner stations.' }],
    signup: ['Apply on Coast’s Get Started page.', 'Your business must be a corporation, LLC or partnership that runs a vehicle fleet — sole proprietorships aren’t approved.', 'Coast may run a soft credit pull (no effect on your personal score) and needs no personal guarantee; approval usually takes 3–5 business days.'],
    withHaulPanel: 'Coast connects with QuickBooks, and HaulPanel connects with QuickBooks too — fuel and other card spend and your loads’ revenue meet in the same books.',
    goodToKnow: ['Sole proprietorships aren’t approved — a single-truck owner-operator needs an LLC or corporation first.', 'It’s a charge card, not a credit line: pay in full each statement, and over-the-road trucking accounts stay on statements of 7 days or less.', 'Coast’s own pages give different partner-station counts, and its own blog says it is built for local service fleets more than long-haul — compare with truck-stop diesel cards.'],
    faq: [
      ['Where is the Coast card accepted?', 'Anywhere Visa is accepted. Use outside the US and Canada has to be requested and carries a 2.5% fee.'],
      ['How much does Coast cost?', '$4 per active user per month; Bill Pay is $99 a month. Late, returned-payment and foreign-transaction fees apply.'],
      ['Does applying need a personal guarantee?', 'No. Coast may run a soft pull that doesn’t affect your personal credit score, and every account is subject to credit approval.'],
      ['Can a sole-proprietor owner-operator apply?', 'Not at this time — Coast approves corporations, LLCs and partnerships only.'],
      ['What fuel discount does Coast give?', '3¢ to 9¢ per gallon at its partner stations.'],
    ],
    sources: ['https://coastpay.com/', 'https://coastpay.com/pricing/', 'https://coastpay.com/faqs/', 'https://coastpay.com/about/', 'https://coastpay.com/blog/atob-fuel-card-reviews/', 'https://apply.coastpay.com/get-started'],
  },
  {
    id: 'nextins', slug: 'next-insurance', updated: UPDATED,
    title: 'NEXT Insurance for Dispatchers & Small Businesses — What It Covers (2026)',
    description: 'NEXT Insurance (ERGO NEXT): online general liability, professional liability and workers’ comp for small businesses, from $19/month — and why it does not replace trucking insurance for carriers.',
    h1: 'NEXT Insurance: business insurance for dispatch offices',
    lead: 'NEXT sells small-business insurance online — general liability, professional liability, workers’ comp and more, with a certificate right after you pay. It can fit an office-based dispatch service; it is not truck insurance.',
    glance: [['Best for', 'Office-based dispatch services'], ['General liability', 'From $19/month (some businesses)'], ['Buy', 'Online, instant certificate'], ['Truck / cargo insurance', 'No'], ['FMCSA filings', 'Not mentioned'], ['Since', '2016 · Palo Alto, CA'], ['Owner', 'ERGO (Munich Re), since 2025']],
    features: [
      { h: 'General liability', p: 'Claims of injury or property damage from your business — starting at $19 a month for some low-risk businesses.' },
      { h: 'Professional liability (E&O)', p: 'For mistakes in the services you provide — eligibility depends on your business type.' },
      { h: 'Workers’ comp', p: 'If your dispatch office has employees.' },
      { h: 'Hired & non-owned auto', p: 'An add-on to general liability for employees driving personal or rented cars for work — not for trucks.' },
      { h: 'Instant certificate', p: 'Coverage starts after payment and the certificate of insurance is ready at no extra cost.' },
      { h: 'Support', p: '24/7 chat and US-based agents on weekdays.' },
    ],
    pricing: 'NEXT quotes online. General liability “starts at $19/month” for some low-risk businesses (not guaranteed). Commercial auto is not written by NEXT — it partners with Progressive, and that coverage excludes truck-tractors and vehicles larger than standard trucks or SUVs.',
    signup: ['Start an instant quote on NEXT’s site and choose your business type.', 'Pick the coverages and limits; underwriting decides eligibility.', 'Pay and download your certificate of insurance right away.'],
    withHaulPanel: 'HaulPanel runs the dispatch side — loads, carriers, rate cons, invoices and carrier statements — so your office has the paperwork insurers and brokers ask for in one place.',
    goodToKnow: ['NEXT doesn’t cover truck operations: no cargo, no tractors or heavy trucks, no FMCSA filings mentioned. Carriers with MC authority need a trucking insurer or agent.', 'A freight broker’s $75,000 BMC-84 bond or BMC-85 trust is separate — general liability doesn’t replace it.', 'NEXT has no page for brokers or dispatchers; confirm your eligibility in the quote.'],
    faq: [
      ['Does NEXT insure semi trucks?', 'No. Commercial auto goes through its partner Progressive, and NEXT’s commercial auto FAQ excludes truck-tractors and vehicles larger than standard trucks or SUVs.'],
      ['Does NEXT offer cargo insurance?', 'No. NEXT says its commercial auto covers the vehicle, not the items it carries.'],
      ['Can a truck dispatcher buy general liability from NEXT?', 'NEXT has no page for dispatchers or brokers; eligibility depends on the business type you enter in the quote and on underwriting.'],
      ['Does NEXT file insurance with FMCSA?', 'NEXT’s official pages don’t mention FMCSA filings (like BMC-91X or MCS-90).'],
      ['How fast do I get a certificate?', 'Coverage starts right after payment, and the certificate is ready at no extra cost.'],
    ],
    sources: ['https://www.nextinsurance.com/', 'https://www.nextinsurance.com/commercial-auto-insurance/', 'https://www.nextinsurance.com/faq-category/commercial-auto', 'https://www.nextinsurance.com/hired-and-non-owned-auto-insurance/', 'https://www.nextinsurance.com/general-liability-insurance/', 'https://www.nextinsurance.com/about-us/'],
  },
];

export const FUEL_COMPARISON: Comparison = {
  slug: 'best-fuel-cards-for-truckers', category: 'fuel', crumb: 'Fuel cards compared', updated: UPDATED,
  title: 'Best Fuel Cards for Owner-Operators & Small Fleets (2026 Comparison)',
  description: 'Fuel cards for truckers compared from their own sites: AtoB, Mudflap, TCS, Coast, EFS/WEX and RoadFlex — discounts, networks, fees, credit checks and who each fits.',
  h1: 'Fuel cards for truckers compared',
  lead: 'Discounts, networks and requirements of the fuel cards owner-operators and small fleets ask about most — as each company states them on its own site.',
  columns: ['Discount (as stated by the company)', 'Network / acceptance', 'Who it fits'],
  rows: [
    { name: 'AtoB', url: 'https://www.atob.com/', cells: ['Avg. 42¢/gal off diesel at partner truck stops (H1 2026)', '4,200+ partner truck stops; Mastercard', 'Owner-operators and fleets'] },
    { name: 'Mudflap', url: 'https://www.mudflapinc.com/', cells: ['Up to $1.00/gal (cost-plus)', '3,800+ in-network truck stops', 'Owner-operators — free app, no credit check'] },
    { name: 'TCS Fuel Card', url: 'https://www.tcsfuel.com/', cells: ['Avg. 49¢/gal in-network (Q1–Q3 2026)', '2,300+ in-network; 12,000+ accept', 'Owner-operators, small fleets; cash-secured'] },
    { id: 'coast', name: 'Coast', cells: ['3–9¢/gal at partner stations', 'Wherever Visa is accepted', 'Local and regional fleets (LLC/corp)'] },
    { name: 'WEX / EFS', url: 'https://www.efsllc.com/', cells: ['Not published', 'Truck stop networks', 'Mid-size to large carriers'] },
    { name: 'RoadFlex', url: 'https://www.roadflex.com/', cells: ['Discounts at partner brands', 'Wherever Visa is in the US', 'Small fleets; credit approval'] },
  ],
  sections: [
    { h: 'How to choose a fuel card', p: [
      'Look at where you actually fuel. A big discount only matters at stations on your lanes — check the in-network map against your routes.',
      'Check how the discount works: cost-plus, retail-minus or a flat cents-per-gallon, and whether it applies to diesel at the pump or only in network.',
      'Read the fees and requirements: monthly or per-transaction fees, out-of-network fees, credit checks or a deposit, and whether a sole proprietor can apply.',
      'Controls and reports matter for fleets: per-driver limits, fraud protection and IFTA fuel reports save hours every quarter.',
    ] },
  ],
  withHaulPanel: 'HaulPanel’s fuel cost calculator shows what a better price per gallon saves you a year, and the board shows each truck’s rate per mile after deadhead — so you see which lanes pay for the fuel.',
  faq: [
    ['Which fuel card gives the biggest discount?', 'It depends on where you fuel. Companies state their own averages (for example AtoB 42¢, TCS 49¢, Mudflap up to $1.00 per gallon at in-network stops) — compare them on your lanes.'],
    ['Can I get a fuel card with no credit check?', 'Mudflap’s app needs no application or credit check for owner-operators; TCS offers a cash-secured card. Most fleet cards need credit approval.'],
    ['Do fuel cards help with IFTA?', 'Many fleet cards produce fuel reports by state that help with IFTA filing; check each card’s reporting.'],
  ],
  sources: ['https://www.atob.com/', 'https://www.mudflapinc.com/', 'https://www.tcsfuel.com/', 'https://coastpay.com/pricing/', 'https://www.efsllc.com/', 'https://www.roadflex.com/'],
};
