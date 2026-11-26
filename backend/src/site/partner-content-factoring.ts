import type { Comparison, Profile } from './partner-profiles.js';

// Factoring companies — facts from their own sites, checked 2026-11-26. Where a company's own pages disagree, the
// page says so instead of picking a number.

const UPDATED = '2026-11-26';
const HP_FACTOR = 'Mark the carrier as factoring with them once, and HaulPanel sends each delivered load’s packet — invoice with their remit-to, rate con, BOL and POD in one PDF — to the factor’s email in one click, and tracks what is paid.';

export const FACTORING_PROFILES: Profile[] = [
  {
    id: 'otr', slug: 'otr-solutions', updated: UPDATED,
    title: 'OTR Solutions Factoring — Instant Funding, Non-Recourse, Fuel Card (2026)',
    description: 'OTR Solutions freight factoring explained: 90–99% advances, instant 24/7 funding, recourse and “True Non-Recourse”, fuel card, documents to apply and what to ask before you sign.',
    h1: 'OTR Solutions: freight factoring with instant funding',
    lead: 'OTR Solutions (formerly OTR Capital) buys carriers’ freight invoices and pays out in seconds, 24/7 — with recourse or non-recourse factoring, advances before delivery and its own fuel card.',
    glance: [['Best for', 'Owner-operators, new authorities, fleets'], ['Advance', '90–99% of the invoice'], ['Funding', 'Instant, 24/7/365'], ['Types', 'Recourse and non-recourse'], ['Rate', 'Not published — by quote'], ['Credit check', 'No'], ['HQ', 'Roswell, GA · since 2011']],
    features: [
      { h: 'Instant funding, 24/7', p: 'Approved invoices can be paid to any bank account within seconds, any day of the year. Same-day ACH and wire are also available.' },
      { h: 'Recourse or non-recourse', p: 'Recourse usually costs less. “True Non-Recourse” moves qualifying broker non-payment to OTR, if you met your obligations on the load.' },
      { h: 'Money before delivery', p: 'An advance of up to 50% of the linehaul, taken out of the final payment — a $15 Fuel Card or $24 Comchek advance fee.' },
      { h: 'Broker checks before you book', p: 'Check whether OTR approves a broker in the mobile app or client portal, 24/7, before taking the load.' },
      { h: 'Fuel card', p: 'Average $0.50/gal savings at 3,000+ in-network locations; pairing it with factoring can lower your factoring rate by up to 0.5%.' },
      { h: 'Help switching factors', p: 'A free review of your current factoring contract and help with the buyout.' },
    ],
    pricing: 'OTR does not publish its factoring rate: it depends on your volume and on recourse vs non-recourse. A contract is required; its length is not published. There are no monthly volume minimums, and you choose which brokers to factor — but once you factor a broker, all of that broker’s invoices go through OTR until it releases them.',
    plans: [{ name: 'Fuel Card advance', price: '$15', what: 'Fee for an advance before delivery, paid to the OTR Fuel Card.' }, { name: 'Comchek advance', price: '$24', what: 'Fee for an advance before delivery by Comchek.' }, { name: 'Factoring + fuel card', price: 'up to −0.5%', what: 'Lower factoring rate when you also use the OTR Fuel Card.' }],
    signup: ['Open the application on OTR’s Get Started page.', 'Upload proof of insurance, your articles of ownership and your operating authority. OTR does not run a credit check.', 'Get your rate and contract, read the terms (length, notice period, fees), then sign.', 'Submit each load with the rate confirmation and proof of delivery — OTR bills the broker and collects.'],
    withHaulPanel: HP_FACTOR,
    goodToKnow: ['The factoring rate isn’t published — ask for the full rate and fee schedule in writing before you sign.', 'A contract is required. Check its length, auto-renewal, notice period and early-termination fees.', '“True Non-Recourse” covers qualifying non-payment only, and only when you met your contract obligations.'],
    faq: [
      ['Does OTR Solutions offer recourse or non-recourse factoring?', 'Both. Recourse often has lower rates. True Non-Recourse moves qualifying broker non-payment risk to OTR, including when the broker is still in business.'],
      ['How fast does OTR pay?', 'Eligible carriers can get Truly Instant Funding within seconds of invoice approval, 24/7/365. Same-day funding, ACH and wire are also available.'],
      ['Do I have to factor every invoice?', 'No. There are no monthly minimums and you pick the brokers. Once you factor a broker’s invoices, you keep factoring that broker until OTR releases them.'],
      ['What documents do I need to apply?', 'Proof of insurance, articles of ownership and operating authority; OTR may ask for more. It does not run a credit check, and new authorities can apply.'],
      ['Can I get paid before the load is delivered?', 'Yes — up to 50% of the linehaul, deducted from the final payment. A Fuel Card advance costs $15 and a Comchek advance $24.'],
    ],
    sources: ['https://www.otrsolutions.com/', 'https://www.otrsolutions.com/about-us', 'https://www.otrsolutions.com/faqs', 'https://www.otrsolutions.com/solutions/true-non-recourse-factoring', 'https://www.otrsolutions.com/get-started'],
  },
  {
    id: 'ecapital', slug: 'ecapital', updated: UPDATED,
    title: 'eCapital Freight Factoring — Funding in 1 Hour, Fuel Program (2026)',
    description: 'eCapital freight factoring for owner-operators, fleets and brokers: recourse and non-recourse, funding in as little as an hour, free credit checks, fuel discounts, documents to apply and what to confirm.',
    h1: 'eCapital: freight factoring for carriers and brokers',
    lead: 'eCapital factors invoices for owner-operators, fleets of every size and freight brokers — recourse or non-recourse, with funding in as little as an hour, free broker credit checks and a fuel program.',
    glance: [['Best for', 'Owner-operators, fleets, brokers'], ['Advance', 'Up to 98% (FAQ)'], ['Funding', 'In as little as 1 hour'], ['Types', 'Recourse and non-recourse'], ['Rate', 'Not published — by quote'], ['Contract', 'No long-term contract (per eCapital)'], ['HQ', 'Miami, FL']],
    features: [
      { h: 'Fast funding', p: 'First funding within 48 hours of signing; after that, funding in as little as an hour, including same-day and weekends.' },
      { h: 'Recourse or non-recourse', p: 'Under recourse you buy back an unpaid invoice after the recourse period (usually 60–90 days). Non-recourse costs more.' },
      { h: 'Free credit checks', p: 'Unlimited credit checks on the brokers and shippers you work with.' },
      { h: 'Fuel program', p: 'Average $0.43/gal discount, no monthly or annual fees, IFTA reporting — available with or without factoring.' },
      { h: 'App and portal', p: 'Upload invoices, request payments, transfer funds and track funding from iOS, Android or the web.' },
      { h: 'For fleets and brokers', p: 'Bulk invoice upload and driver logins for fleets; factoring and financing for freight brokers too.' },
    ],
    pricing: 'eCapital doesn’t publish rates: the cost depends on the services you use and your volume, and you get it in a free quote. Fees come out of the advance; non-recourse costs more than recourse. eCapital says there are no long-term contracts and no monthly payments. If you factor one load from a customer, you factor all loads from that customer.',
    signup: ['Request a quote on eCapital’s freight factoring page (name, company, phone, email) — they say they call back within 24 hours.', 'Send the documents: credit application, government ID, articles of incorporation, insurance, a voided check and your operating authority.', 'eCapital sends a Notice of Assignment to your customers, then funds your first invoices within 48 hours of signing.'],
    withHaulPanel: HP_FACTOR,
    goodToKnow: ['eCapital’s own pages disagree on the advance (up to 98% vs up to 100%) and the fuel credit ($2,500 vs $5,000) — get your numbers in writing.', 'Ask for the full fee schedule, including document or setup fees.', 'Factoring one load from a customer means factoring all of that customer’s loads; eCapital’s general FAQ says non-recourse covers a customer’s bankruptcy, not every kind of non-payment.'],
    faq: [
      ['Does eCapital offer recourse and non-recourse factoring?', 'Yes. Under recourse you buy back an invoice your customer doesn’t pay after the recourse period (usually 60–90 days). Non-recourse costs more.'],
      ['How much does eCapital advance?', 'Its FAQ says up to 98% of the invoice amount; other eCapital pages say up to 100%. Confirm it in your quote.'],
      ['How fast does eCapital fund?', 'The first funding comes within 48 hours of signing. After that, eCapital advertises funding in as little as an hour, with same-day and weekend funding.'],
      ['Is a long-term contract required?', 'eCapital says no long-term contracts and no monthly payments. If you factor one load from a customer, you factor all of that customer’s loads.'],
      ['Can I use the eCapital fuel program without factoring?', 'Yes. It is sold on its own: an average $0.43/gal discount, no monthly fees and pre-approved fuel credit.'],
    ],
    sources: ['https://ecapital.com/transportation/', 'https://ecapital.com/products/freight-factoring/', 'https://ecapital.com/transportation/owner-operators/', 'https://ecapital.com/faqs/', 'https://ecapital.com/apps/', 'https://ecapital.com/history/', 'https://ecapital.com/news/ecapital-and-123loadboard-establish-strategic-collaboration-to-connect-transportation-clients-with-freight-opportunities/'],
  },
  {
    id: 'bobtail', slug: 'bobtail', updated: UPDATED,
    title: 'Bobtail Factoring — Flat Fee, No Reserve, 90-Day Risk-Free (2026)',
    description: 'Bobtail freight factoring for owner-operators and small fleets: one flat fee per invoice, no reserve, free same-day funding, 90-day risk-free start, fleet card and TMS. Fees, contract and what to confirm.',
    h1: 'Bobtail: flat-fee factoring for small carriers',
    lead: 'Bobtail factors invoices for owner-operators, small fleets and new carriers for one flat fee per invoice — no reserve, free same-day funding, and a 90-day risk-free start.',
    glance: [['Best for', 'Owner-operators, small fleets, new carriers'], ['Fee', '1.5–3.5% per invoice (FAQ)'], ['Reserve', 'None'], ['Funding', 'Same day if sent by 11 AM ET'], ['Types', 'Recourse (no non-recourse listed)'], ['Start', 'Cancel free in first 90 days'], ['HQ', 'Maryland']],
    features: [
      { h: 'One flat fee, no reserve', p: 'A single fee per invoice with no reserve held back, and no monthly minimums.' },
      { h: 'Free same-day funding', p: 'Invoices sent before 11 AM ET, Monday–Friday, are funded the same day by 6 PM ET; faster payment costs extra.' },
      { h: 'You pick the brokers', p: 'Choose which brokers to factor and which to bill yourself.' },
      { h: 'Broker credit checks', p: 'Bobtail checks every broker and shipper, and you can check a broker in the app before pickup.' },
      { h: 'Fleet card', p: 'Bobtail Mastercard: no monthly, transaction or setup fees; average 59¢/gal at participating locations; automatic IFTA reports.' },
      { h: 'TMS included', p: 'Bobtail builds its own TMS, factoring and fleet card; support in English, Spanish and Punjabi.' },
    ],
    pricing: 'Bobtail publishes its fees, but two of its own pages disagree: the factoring FAQ says 1.5%–3.5% per invoice depending on volume and credit risk, while the homepage says “Negotiable Rates, Max 3.24%”. Standard funding is free; expedited payment costs extra (amount not published). You can cancel without penalty in the first 90 days; the homepage mentions a month-to-month agreement, while the FAQ says a long-term contract applies after the trial.',
    plans: [{ name: 'Factoring fee (FAQ)', price: '1.5–3.5%', what: 'Per invoice, depending on volume and credit risk.' }, { name: 'Homepage', price: 'Max 3.24%', what: 'Negotiable rates, no hidden fees or monthly minimums.' }, { name: 'Standard funding', price: '$0', what: 'Same-day or next-day; expedited payment costs extra.' }],
    signup: ['Start on Bobtail’s Get Started page or contact the team.', 'Onboard online (about an hour) with your driver’s license and insurance document — sometimes incorporation papers too. New carriers are accepted.', 'Send invoices from the app with the signed BOL and rate confirmation; send before 11 AM ET for same-day funding.'],
    withHaulPanel: HP_FACTOR,
    goodToKnow: ['Bobtail’s homepage and FAQ give different fees (max 3.24% vs 1.5–3.5%) and contract terms — get yours in writing.', 'No non-recourse product is listed; ask what happens when a broker doesn’t pay.', 'Expedited payment costs extra and the amount isn’t published; fleet card savings apply at participating locations only.'],
    faq: [
      ['How much does Bobtail charge?', 'The factoring FAQ says 1.5%–3.5% per invoice, depending on volume and credit risk; the homepage says “Negotiable Rates, Max 3.24%”. Bobtail says there are no hidden fees, no monthly minimums and no reserve.'],
      ['How fast does Bobtail pay?', 'Same-day or next-day funding is free. Invoices sent before 11 AM ET, Monday–Friday, are funded the same day by 6 PM ET. Expedited payment costs extra.'],
      ['Is there a contract?', 'You can cancel without penalty in the first 90 days. The FAQ says a long-term contract applies after that, but the homepage mentions month-to-month — confirm before signing.'],
      ['What do I need to sign up?', 'A driver’s license and an insurance document, sometimes incorporation documents. Onboarding takes about an hour and new carriers are accepted.'],
      ['Do I have to factor all my loads?', 'No. You choose which brokers to factor and which to bill yourself.'],
    ],
    sources: ['https://www.bobtail.com/', 'https://www.bobtail.com/factoring/', 'https://www.bobtail.com/faqs-factoring/', 'https://www.bobtail.com/factor-with-bobtail/get-started/', 'https://www.bobtail.com/blog/non-recourse-factoring/', 'https://www.bobtail.com/fleet-card/'],
  },
];

export const FACTORING_COMPARISON: Comparison = {
  slug: 'best-factoring-companies', category: 'factoring', crumb: 'Factoring companies compared', updated: UPDATED,
  title: 'Best Freight Factoring Companies for Small Carriers (2026 Comparison)',
  description: 'OTR Solutions, eCapital, Bobtail, RTS, Triumph and Apex compared from their own sites: advance, funding speed, recourse vs non-recourse, contracts, fuel cards — and how to pick a factoring company.',
  h1: 'Freight factoring companies compared',
  lead: 'What the factoring companies small carriers ask about most say on their own sites — advance, funding speed, recourse, contract and extras — side by side.',
  columns: ['Best for', 'Advance', 'Funding', 'Recourse', 'Contract', 'Extras'],
  rows: [
    { id: 'otr', name: 'OTR Solutions', cells: ['Owner-operators, fleets', '90–99%', 'Instant, 24/7', 'Recourse + non-recourse', 'Required; length not published', 'Fuel card, pre-delivery advances'] },
    { id: 'ecapital', name: 'eCapital', cells: ['Carriers and brokers of any size', 'Up to 98% (FAQ)', 'As fast as 1 hour', 'Recourse + non-recourse', 'No long-term contract (per eCapital)', 'Fuel program, free credit checks'] },
    { id: 'bobtail', name: 'Bobtail', cells: ['Small fleets, new carriers', 'Flat fee 1.5–3.5%, no reserve', 'Same day before 11 AM ET', 'Recourse', '90 days risk-free', 'Fleet card, own TMS'] },
    { name: 'RTS Financial', url: 'https://rtsinc.com/trucking-services/freight-factoring', cells: ['Carriers', 'See RTS', 'Same day (per RTS)', 'See RTS', 'See RTS', 'Fuel discounts, free load board'] },
    { name: 'Triumph', url: 'https://www.triumph.io/carrier/factoring/', cells: ['Carriers and brokers', 'See Triumph', '“Paid in minutes” (per Triumph)', 'See Triumph', 'See Triumph', 'Payments network, banking'] },
    { name: 'Apex Capital', url: 'https://www.apexcapitalcorp.com', cells: ['Trucking companies', 'See Apex', 'Minutes after purchase (per Apex)', 'See Apex', 'See Apex', 'Fuel card, startup support'] },
  ],
  sections: [
    { h: 'How to choose a factoring company', p: [
      'Compare the total cost, not the headline rate: ask for the full fee schedule in writing — the factoring rate, plus any ACH, wire, invoice, document, setup or “no-buy” fees, and how a recourse buyback works.',
      'Read the contract before you sign: its length, auto-renewal, the notice period to leave (often 30–90 days) and early-termination fees. A risk-free trial or month-to-month terms make it easier to switch.',
      'Recourse vs non-recourse: with recourse you buy back an invoice the broker doesn’t pay; with non-recourse the factor takes that risk — but only for the cases its contract names (often broker bankruptcy or insolvency), so read what is covered.',
      'Check how you send invoices (app, portal, or straight from your TMS), how fast money lands, and whether you must factor every load from a broker once you start.',
    ] },
    { h: 'Factoring or quick pay?', p: ['Quick pay is a broker paying early for a fee, load by load, with no contract — but only brokers that offer it. Factoring works with almost every broker and adds credit checks and collections, usually with a contract. Our guide compares them in detail: Factoring vs quick pay.'] },
  ],
  withHaulPanel: 'HaulPanel sends the invoice packet to your factor in one click and keeps every load’s rate con, BOL and POD ready — so funding isn’t held up by missing paperwork.',
  faq: [
    ['What is freight factoring?', 'A factoring company buys your freight invoices: it pays you most of the amount right away, collects from the broker, and keeps a fee.'],
    ['How much does freight factoring cost?', 'Most companies don’t publish rates; those that do (like Bobtail) show a few percent per invoice. The total depends on volume, recourse vs non-recourse and extra fees — ask for everything in writing.'],
    ['Which factoring company pays fastest?', 'OTR Solutions advertises instant 24/7 funding, eCapital funding in as little as an hour, and Bobtail same-day funding for invoices sent before 11 AM ET.'],
    ['Can a new authority get factoring?', 'Yes — OTR, eCapital and Bobtail all say they accept new carriers. Approval depends mostly on your brokers’ credit, not yours.'],
  ],
  sources: ['https://www.otrsolutions.com/faqs', 'https://ecapital.com/faqs/', 'https://www.bobtail.com/faqs-factoring/', 'https://rtsinc.com/trucking-services/freight-factoring', 'https://www.triumph.io/carrier/factoring/', 'https://www.apexcapitalcorp.com'],
};
