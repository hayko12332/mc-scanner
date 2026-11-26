import type { Comparison, Profile } from './partner-profiles.js';

// Starting and running the business: LLC formation (ZenBusiness, Northwest), bookkeeping (QuickBooks) and the
// FMCSA steps to start a trucking company — from official sites, checked 2026-11-26.

const UPDATED = '2026-11-26';
const HP_START = 'Once the paperwork is done, HaulPanel runs the business side for free: loads from rate cons, BOL and POD on each load, invoices to brokers or your factor in one click, and FMCSA checks on every broker you work with.';

export const BUSINESS_PROFILES: Profile[] = [
  {
    id: 'zenbusiness', slug: 'zenbusiness-llc', updated: UPDATED,
    title: 'ZenBusiness LLC Formation for Truckers & Dispatchers — Plans and Prices (2026)',
    description: 'Form an LLC for your trucking or dispatch business with ZenBusiness: Starter $0, Pro $199, Premium $299 plus state fees (Nov 2026), EIN and operating agreement, compliance — and what an LLC does not give you.',
    h1: 'ZenBusiness: form the LLC for your trucking or dispatch business',
    lead: 'ZenBusiness files your LLC with the state and can handle the EIN, operating agreement, registered agent and yearly compliance — the business setup you need before USDOT, authority and insurance.',
    glance: [['Best for', 'New carriers and dispatch services'], ['Plans', '$0 / $199 / $299 + state fees'], ['EIN', 'Included in Pro and Premium'], ['Processing', '7–10 days (Starter), 1 day (Pro, Premium)'], ['Refund', '60-day money-back (minus fees)'], ['Since', '2015']],
    features: [
      { h: 'LLC filing', p: 'Name search and filing with your state; 1-day processing on Pro and Premium (the state’s own time is extra).' },
      { h: 'EIN', p: 'ZenBusiness gets your EIN — included in Pro and Premium, a $99 add-on on Starter. It is also free directly from the IRS.' },
      { h: 'Operating agreement', p: 'A template for how the LLC is owned and run — included in Pro and Premium.' },
      { h: 'Registered agent', p: 'Receives legal and state mail for your LLC; a separate add-on.' },
      { h: 'Worry-Free Compliance', p: 'Annual report filing and up to two amendments a year — included in Pro and Premium.' },
      { h: 'Extras', p: 'Website builder, business email, domain and a documents library on Premium.' },
    ],
    pricing: 'As listed on ZenBusiness’s pricing page on November 26, 2026 — state filing fees are always extra and vary by state. Pro and Premium renew yearly. The registered agent add-on is listed at $199 a year in the plan table, while the page’s FAQ mentions $99 for the first year — check the current price there.',
    plans: [{ name: 'Starter', price: '$0 + state fee', what: 'LLC filing in 7–10 business days; EIN and operating agreement are add-ons.' }, { name: 'Pro', price: '$199/yr', what: 'Adds EIN, operating agreement, compliance and 1-day processing.' }, { name: 'Premium', price: '$299/yr', what: 'Adds domain, business email, documents library and compliance protection.' }],
    signup: ['Pick a plan on ZenBusiness’s formation pricing page and check your state’s filing fee.', 'Enter the business name, address and owners — use the exact name and address you will later give FMCSA.', 'Get the approved LLC and EIN, then apply for your USDOT number and operating authority.'],
    withHaulPanel: HP_START,
    goodToKnow: ['An EIN is free from the IRS — paying for it buys only convenience.', 'Pro and Premium renew every year; cancel add-ons you don’t need.', 'An LLC doesn’t give you a USDOT number, MC authority or insurance — those are separate FMCSA steps.'],
    faq: [
      ['How much does ZenBusiness charge to form an LLC?', 'Starter $0, Pro $199 and Premium $299 for the first year, plus state filing fees (listed November 26, 2026).'],
      ['Are state fees included?', 'No — every plan is “plus state fees”, which vary by state.'],
      ['Does ZenBusiness get my EIN?', 'Pro and Premium include it; on Starter it is a $99 add-on. You can also get an EIN yourself from the IRS for free.'],
      ['Does the plan include a registered agent?', 'No, it is a separate add-on — check the current price on ZenBusiness’s pricing page.'],
      ['Can I get a refund?', 'ZenBusiness states a 60-day money-back guarantee, minus state or third-party fees.'],
    ],
    sources: ['https://www.zenbusiness.com/pricing/', 'https://www.zenbusiness.com/pricing-formation-plans/', 'https://www.zenbusiness.com/about-us/', 'https://www.irs.gov/businesses/small-businesses-self-employed/get-an-employer-identification-number'],
  },
  {
    id: 'northwest', slug: 'northwest-registered-agent', updated: UPDATED,
    title: 'Northwest Registered Agent — LLC Formation and Registered Agent for Truckers',
    description: 'Northwest Registered Agent: LLC formation with the first year of registered agent service, then a yearly registered agent fee, in all 50 states — and why it is not the same as the BOC-3 process agent FMCSA requires.',
    h1: 'Northwest Registered Agent: LLC formation and registered agent',
    lead: 'Northwest forms LLCs in every state and acts as your registered agent — useful when your LLC is registered in another state, or to keep your home address off public filings.',
    glance: [['Best for', 'Owners who want a long-term registered agent'], ['LLC formation', '$39 + state fees*'], ['Registered agent', '$125/yr after year one*'], ['Coverage', 'All 50 states'], ['HQ', 'Spokane, WA'], ['*Prices', 'Confirm on Northwest’s site']],
    features: [
      { h: 'LLC formation', p: 'LLC, corporation and foreign qualification filings in every state, with the first year of registered agent service included.' },
      { h: 'Registered agent', p: 'Receives legal and state mail for your company — also sold on its own if you file the LLC yourself.' },
      { h: 'Privacy', p: 'A registered agent address on public filings instead of your home address.' },
      { h: 'Mail forwarding', p: 'Business address and mail forwarding services, priced by state.' },
    ],
    pricing: 'Northwest’s site does not allow automated checks, so these prices come from its own pages as shown in search results on November 26, 2026 — confirm them on Northwest’s site: LLC formation $39 plus state fees with the first year of registered agent included; registered agent $125 a year after that ($100 per state for five or more states).',
    plans: [{ name: 'LLC formation', price: '$39 + state fee', what: 'Includes the first year of registered agent service.' }, { name: 'Registered agent', price: '$125/yr', what: 'After the first year; $100/yr per state for 5+ states.' }],
    signup: ['Start on Northwest’s LLC page and choose your state.', 'Enter your business details and pay the state fee.', 'After the LLC is approved, get your EIN from the IRS and move on to USDOT and authority.'],
    withHaulPanel: HP_START,
    goodToKnow: ['The low formation price includes only the first year of registered agent service; it renews yearly after that.', 'Your LLC’s registered agent is not the BOC-3 process agent FMCSA requires — that is filed by an FMCSA-registered blanket company.', 'We could not read Northwest’s pages directly — confirm every price on its site before you buy.'],
    faq: [
      ['How much does Northwest charge to form an LLC?', '$39 plus state fees per its LLC page as seen in search results on November 26, 2026 — confirm on Northwest’s site.'],
      ['What does the registered agent cost after year one?', '$125 a year, or $100 a year per state for five or more states, per Northwest’s registered agent page.'],
      ['Is a registered agent the same as a BOC-3 process agent?', 'No. The registered agent receives your LLC’s legal mail in its state; the BOC-3 process agents for your operating authority are filed with FMCSA by a blanket company.'],
      ['Are state fees included?', 'No, state filing fees are separate and vary by state.'],
    ],
    sources: ['https://www.northwestregisteredagent.com/llc', 'https://www.northwestregisteredagent.com/registered-agent', 'https://www.northwestregisteredagent.com/contact-us', 'https://www.fmcsa.dot.gov/registration/process-agents'],
  },
  {
    id: 'quickbooks', slug: 'quickbooks-for-trucking', updated: UPDATED,
    title: 'QuickBooks Online for Trucking Companies — Plans, Prices, What It Does (2026)',
    description: 'QuickBooks Online for owner-operators, carriers and dispatch services: Simple Start $38, Essentials $85, Plus $140, Advanced $340 a month list (Nov 2026), invoices, expenses, mileage, payroll add-on — and how it works with a TMS.',
    h1: 'QuickBooks Online for trucking companies',
    lead: 'QuickBooks Online keeps the books — invoices, expenses, bills, mileage and payroll as an add-on. It is accounting, not a TMS: pair it with a TMS for loads, rate cons and dispatch.',
    glance: [['Best for', 'Bookkeeping for carriers and dispatch services'], ['From', '$38/month list (Simple Start)'], ['Invoices', '2/month on Simple Start; more on higher plans'], ['Payroll', 'Add-on from $50/mo + $7/employee'], ['Cancel', 'Any time, per Intuit'], ['Maker', 'Intuit · since 1983']],
    features: [
      { h: 'Invoices and payments', p: 'Invoice customers and get paid; Essentials adds bulk invoices, Advanced batch invoices and expenses.' },
      { h: 'Income and expenses', p: 'Bank feeds with automatic categorization of fuel, repairs, tolls and every other expense.' },
      { h: 'Bill pay', p: 'Pay bills by ACH with free monthly allotments.' },
      { h: 'Mileage', p: 'The QuickBooks mobile app can track trips automatically by phone location.' },
      { h: 'Users and projects', p: '1 user on Simple Start, 3 on Essentials, 5 on Plus with project profitability, 25 on Advanced.' },
      { h: 'Payroll add-on', p: 'Full-service payroll with direct deposit and 1099 e-filing, from $50 a month plus $7 per employee.' },
    ],
    pricing: 'List prices on Intuit’s pricing page on November 26, 2026 (a 70%-off-for-3-months promotion was running; budget on the list price). Simple Start allows 2 invoices a month unless you use QuickBooks Payments — tight for a carrier billing many loads.',
    plans: [{ name: 'Simple Start', price: '$38/mo', what: '1 user, income and expenses, 2 invoices a month.' }, { name: 'Essentials', price: '$85/mo', what: '3 users, time on invoices, bulk invoices.' }, { name: 'Plus', price: '$140/mo', what: '5 users, inventory, project profitability.' }, { name: 'Advanced', price: '$340/mo', what: '25 users, batch invoices and expenses.' }],
    signup: ['Pick a plan on Intuit’s QuickBooks pricing page.', 'Connect your business bank account and card so expenses flow in.', 'Connect QuickBooks to HaulPanel so loads’ invoices land in your books.'],
    withHaulPanel: 'Connect QuickBooks in HaulPanel’s Integrations: invoices you send from HaulPanel and their payments go into QuickBooks, so loads and books match without double entry.',
    goodToKnow: ['Promo prices last 3 months — budget on the list price.', 'Simple Start’s 2-invoices-a-month limit is tight for a carrier unless you use QuickBooks Payments.', 'QuickBooks doesn’t do dispatch, loads or IFTA mileage by state — that is what a TMS is for.'],
    faq: [
      ['How much is QuickBooks Online?', 'List prices on November 26, 2026: Simple Start $38, Essentials $85, Plus $140, Advanced $340 a month.'],
      ['Can I invoice brokers from Simple Start?', 'Simple Start allows 2 invoices a month, or unlimited with QuickBooks Payments; higher plans add bulk and batch invoicing.'],
      ['Does QuickBooks track mileage?', 'Yes, the mobile app can track trips automatically by phone location; you mark each trip business or personal.'],
      ['Is payroll included?', 'No — it is an add-on starting at $50 a month plus $7 per employee (list price).'],
      ['Does QuickBooks work with HaulPanel?', 'Yes. Connect it in HaulPanel’s Integrations and invoices and payments sync to your books.'],
    ],
    sources: ['https://quickbooks.intuit.com/pricing/', 'https://quickbooks.intuit.com/payroll/pricing/', 'https://quickbooks.intuit.com/accounting/mileage/', 'https://www.intuit.com/company/origins/'],
  },
];

export const START_GUIDE: Comparison = {
  slug: 'how-to-start-a-trucking-company', category: 'start', crumb: 'Start a trucking company', updated: UPDATED,
  title: 'How to Start a Trucking Company in 2026 — Every Step, Fee and Form',
  description: 'Start a trucking company step by step from FMCSA and IRS rules: LLC and EIN, USDOT number in Motus, $300 operating authority, BOC-3, $750,000 insurance, UCR, IRP, IFTA, Form 2290, drug & alcohol program, new entrant audit, ELD.',
  h1: 'How to start a trucking company',
  lead: 'Every step to get a for-hire trucking company on the road legally — what it is, what it costs and where to do it — from FMCSA, IRS and state sources, as of November 2026.',
  columns: ['What it is', 'Cost'],
  rows: [
    { name: '1. LLC and EIN', url: 'https://www.irs.gov/businesses/small-businesses-self-employed/get-an-employer-identification-number', cells: ['Register the business with your state, then get an EIN. Use the exact same name and address everywhere.', 'EIN free from the IRS; LLC fee set by your state'] },
    { name: '2. USDOT number', url: 'https://www.fmcsa.dot.gov/registration/do-i-need-usdot-number', cells: ['Needed for interstate vehicles of 10,001 lbs or more. Apply in Motus, FMCSA’s registration system since May 19, 2026.', 'No FMCSA fee stated for the USDOT number'] },
    { name: '3. Operating authority', url: 'https://www.fmcsa.dot.gov/registration/get-mc-number-authority-operate', cells: ['For-hire carriers and brokers need authority on top of the USDOT number; about 20–25 business days, after identity verification.', '$300 per authority type, card only'] },
    { name: '4. BOC-3 process agent', url: 'https://www.fmcsa.dot.gov/registration/process-agents', cells: ['A process agent in every state, usually filed by an FMCSA-registered blanket company.', 'Set by the blanket company'] },
    { name: '5. Insurance filing', url: 'https://www.fmcsa.dot.gov/registration/insurance-filing-requirements', cells: ['Your insurer files proof with FMCSA; authority isn’t granted without it. Minimum $750,000 liability for general freight at 10,001 lbs+ ($300,000 below).', 'Premiums set by insurers'] },
    { name: '6. UCR', url: 'https://plan.ucr.gov/', cells: ['Yearly registration for interstate carriers and brokers.', '2027: $46 for 0–2 trucks, $138 for 3–5, $276 for 6–20'] },
    { name: '7. IRP plates', url: 'https://www.dmv.ca.gov/portal/driver-education-and-safety/educational-materials/fast-facts/international-registration-plan-irp-ffirp-1/', cells: ['Apportioned plates for interstate trucks over 26,000 lbs or with 3+ axles, from your base state.', 'By miles and weight — set by your state'] },
    { name: '8. IFTA', url: 'https://www.cdtfa.ca.gov/taxes-and-fees/fuel-tax-and-fee-guides/', cells: ['License and decals from your base state; quarterly fuel tax returns (Apr 30, Jul 31, Oct 31, Jan 31).', 'Set by your state'] },
    { name: '9. Form 2290 (HVUT)', url: 'https://www.irs.gov/instructions/i2290', cells: ['Heavy vehicle use tax for 55,000 lbs and up; the stamped Schedule 1 is needed for registration.', 'By weight — IRS example: $550 a year for 80,000 lbs'] },
    { name: '10. Drug & alcohol program', url: 'https://clearinghouse.fmcsa.dot.gov/', cells: ['A DOT testing program, a consortium (C/TPA) for owner-operators, and Clearinghouse registration and queries.', 'Set by providers; Clearinghouse query fee per FMCSA'] },
    { name: '11. New entrant audit', url: 'https://www.fmcsa.dot.gov/safety/new-entrant-safety-assurance-program', cells: ['18 months of monitoring with a safety audit in the first 12. No testing program or no insurance is an automatic failure.', 'No fee stated'] },
    { name: '12. ELD', url: 'https://www.fmcsa.dot.gov/hours-service/elds/electronic-logging-devices', cells: ['Drivers who keep logs need an ELD from FMCSA’s registered list — check it, FMCSA revokes devices.', 'Set by ELD providers'] },
  ],
  sections: [
    { h: 'What changed at FMCSA in 2025–2026', p: [
      'MC numbers are not gone. FMCSA has proposed making the USDOT number the only identifier, but says the change will first go out for public comment in a proposed rule; existing MC numbers will not be replaced (FMCSA page updated April 16, 2026).',
      'Motus, FMCSA’s new registration system, launched May 19, 2026. New registrants go through identity verification, and FMCSA has accepted card payments only since September 30, 2025.',
      'New financial responsibility rules for brokers and freight forwarders took effect January 16, 2026. Brokers still need a $75,000 BMC-84 bond or BMC-85 trust.',
    ] },
    { h: 'Services that help with the setup', p: ['An LLC service (ZenBusiness, Northwest) files the business and EIN; a trucking insurance agent handles the insurance filing; a blanket company files the BOC-3; a consortium runs drug and alcohol testing; an ELD provider (Motive and others) covers hours of service; and a factoring company or quick pay gets the first loads paid fast.'] },
  ],
  withHaulPanel: HP_START,
  faq: [
    ['How much does it cost to start a trucking company?', 'The government fees are small — $300 for operating authority, UCR from $46 a year, an EIN free — but insurance, the truck, IRP plates, IFTA, Form 2290 and an ELD make up most of the cost and depend on your state, truck and record.'],
    ['How long does it take to get authority?', 'FMCSA says new applications take about 20–25 business days, longer if reviewed — and authority is only granted once your insurance and BOC-3 are on file.'],
    ['Are MC numbers being eliminated?', 'Not yet. FMCSA has proposed using the USDOT number only, but says it will publish a proposed rule for comment first, and existing MC numbers will not be replaced.'],
    ['Do I need cargo insurance?', 'Federal rules require no cargo insurance for general freight (household goods differ), but most brokers and shippers ask for it — check what your customers require.'],
  ],
  sources: ['https://www.fmcsa.dot.gov/registration/get-mc-number-authority-operate', 'https://www.fmcsa.dot.gov/registration/insurance-filing-requirements', 'https://www.fmcsa.dot.gov/registration/modernization-faqs', 'https://www.fmcsa.dot.gov/safety/new-entrant-safety-assurance-program', 'https://plan.ucr.gov/', 'https://www.irs.gov/instructions/i2290'],
};
