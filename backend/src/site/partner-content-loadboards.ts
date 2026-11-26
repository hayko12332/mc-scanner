import type { Comparison, Profile } from './partner-profiles.js';

// Load boards — plans and prices as listed on the companies' own pricing pages on 2026-11-26.

const UPDATED = '2026-11-26';
const HP_LB = 'Book the load on the board, drop the rate con into HaulPanel’s AI — it becomes a load with the broker, lane, dates and rate. Then the BOL, POD and invoice live on that load, and you see your real rate per mile by broker and lane.';

export const LOADBOARD_PROFILES: Profile[] = [
  {
    id: 'dat', slug: 'dat-load-board', updated: UPDATED,
    title: 'DAT One Load Board — Plans, Prices & Features for Carriers (2026)',
    description: 'DAT One load board for carriers: Standard $59, Enhanced $149, Pro $169, Select $259, Office $339 a month (listed Nov 2026). Broker credit on every plan, lane rates from Enhanced, mobile app, factoring via Outgo.',
    h1: 'DAT One: the load board with broker credit on every plan',
    lead: 'DAT has run a load board since 1978. DAT One gives carriers load search and truck posting on web and mobile, broker credit and days-to-pay on every plan, and average lane rates from the Enhanced plan up.',
    glance: [['Best for', 'Owner-operators to large fleets'], ['From', '$59/month (Standard)'], ['Broker credit', 'Every carrier plan'], ['Lane rates', 'From Enhanced ($149)'], ['Mobile app', 'DAT One app'], ['Free trial', 'Free account; no paid-plan trial stated'], ['HQ', 'Portland, OR · since 1978']],
    features: [
      { h: 'Load search and truck posting', p: 'On the web and in the DAT One mobile app, with load-match and exact-match alarms.' },
      { h: 'Broker credit on every plan', p: 'Brokers’ average days to pay, credit scores and customer reviews — even on Standard.' },
      { h: 'Lane rates', p: 'Average spot rates for van, reefer and flatbed: 15-day on Enhanced, 7-day on Pro, “Best Available” on Select and Office.' },
      { h: 'TriHaul and company lists', p: 'Triangular routing and Preferred & Blocked Companies from the Pro plan.' },
      { h: 'DAT Assurance', p: 'Help with past-due freight payments: up to $250 on Pro, $500 on Select, $1,000 on Office.' },
      { h: 'Factoring and APIs', p: 'Factoring through DAT Outgo; APIs for load board, posting, booking and tracking through the DAT Developer Portal.' },
    ],
    pricing: 'Carrier plans as listed on dat.com on November 26, 2026 (monthly). Broker plans are $159 / $319 / $449 and broker+carrier combo plans $339 / $469. Prices change — check DAT’s pricing page before you buy.',
    plans: [
      { name: 'Standard', price: '$59/mo', what: 'Search & post, mobile app, alarms, broker credit data. No lane rates.' },
      { name: 'Enhanced', price: '$149/mo', what: 'Adds 15-day average spot lane rates. Recommended for new owner-operators.' },
      { name: 'Pro', price: '$169/mo', what: '7-day rates, TriHaul, Preferred & Blocked Companies, DAT Assurance up to $250.' },
      { name: 'Select', price: '$259/mo', what: 'Best Available rates, Market Conditions Tool, Assurance up to $500. For 3+ trucks.' },
      { name: 'Office', price: '$339/mo', what: 'Contract lane rates, LaneMakers Premium, Workgroups, Assurance up to $1,000.' },
    ],
    signup: ['Create a free DAT One account, or pick a plan on DAT’s pricing page.', 'Have your DOT number ready — DAT says the MC number can be added later.', 'Choose the plan by what you need: Standard for search and broker credit, Enhanced or higher for lane rates.'],
    withHaulPanel: HP_LB,
    goodToKnow: ['The $59 Standard plan has no lane rates; rate data starts at Enhanced ($149).', 'DAT Assurance comes with Pro, Select and Office only.', 'Plans are sold under the DAT One name now; “DAT Power” no longer appears on the pricing page.'],
    faq: [
      ['How much does DAT One cost for carriers?', 'Listed on dat.com on November 26, 2026: Standard $59, Enhanced $149, Pro $169, Select $259 and Office $339 per month.'],
      ['Does DAT show broker credit and days to pay?', 'Yes — every carrier plan includes brokers’ average days to pay, credit scores and customer reviews.'],
      ['Which DAT plan includes rate data?', 'Average spot lane rates start with Enhanced (15-day). Pro shows 7-day, Select and Office “Best Available”. Standard has no lane rates.'],
      ['Do I need an MC number to sign up?', 'DAT asks for your DOT number at sign-up; the MC number can be added later.'],
      ['Does DAT offer factoring?', 'Yes, through DAT Outgo, a separate factoring service. Loads with a $ sign on DAT are factor-eligible.'],
    ],
    sources: ['https://www.dat.com/load-boards/pricing', 'https://www.dat.com/company', 'https://www.dat.com/company/history', 'https://www.dat.com/create-free-account', 'https://www.dat.com/resources/faq', 'https://www.dat.com/api-integration'],
  },
  {
    id: 'truckstop', slug: 'truckstop-load-board', updated: UPDATED,
    title: 'Truckstop Load Board — Plans, Prices & Rate Insights (2026)',
    description: 'Truckstop load board for carriers: Basic $42, Advanced $135, Pro $159 a month (listed Nov 2026), dry van, reefer and heavy-haul plans, broker days-to-pay, Rate Insights, free TMS, mobile app and API.',
    h1: 'Truckstop: load board with Rate Insights and a free TMS',
    lead: 'Truckstop built the first online load board in 1995. Carriers get unlimited load search and truck posting, broker ratings and days-to-pay from Advanced, Rate Insights from paid invoices on Pro, and plans made for dry van, reefer and heavy haul.',
    glance: [['Best for', 'Owner-operators and fleets'], ['From', '$42/month (Basic)'], ['Broker days-to-pay', 'From Advanced ($135)'], ['Rate data', 'Pro ($159) — Rate Insights'], ['Mobile app', 'Truckstop Go'], ['Free trial', 'No; application fee credited if approved'], ['Founded', '1995']],
    features: [
      { h: 'Unlimited search and posting', p: 'Load search, truck and lane posting, private loads from approved brokers and backhaul search.' },
      { h: 'Broker ratings and days-to-pay', p: 'Broker ratings, days-to-pay and complaint history from the Advanced plan.' },
      { h: 'Rate Insights', p: 'On Pro: rates from paid invoice data — same-day guidance, a 7-day trend and a 4-week outlook.' },
      { h: 'Plans by equipment', p: 'Dry van, reefer and Heavy Haul Pro plans with the tools that freight needs (permits, escorts for oversize).' },
      { h: 'Free TMS and mobile app', p: 'Truckstop TMS Free comes with Basic; the Truckstop Go app on iOS and Android.' },
      { h: 'Factoring and API', p: 'Factoring through Truckstop (separate, subject to underwriting); API access with the Pro plan.' },
    ],
    pricing: 'Plans as listed on truckstop.com on November 26, 2026 (monthly, fees and taxes excluded). A non-refundable application fee ($42, or $35 for dry van plans) is credited to your first month if you are approved. Plans renew monthly.',
    plans: [
      { name: 'Basic', price: '$42/mo', what: 'Per user, up to 3 users. Search, posting, private loads, backhauls, TMS Free.' },
      { name: 'Advanced', price: '$135/mo', what: 'Adds broker ratings and days-to-pay, fuel tools and routing.' },
      { name: 'Pro', price: '$159/mo', what: 'Adds Rate Insights, live loads, lane planning, load comparison, API access.' },
      { name: 'Heavy Haul Pro', price: '$299/mo', what: 'Oversize loads, wider radius, rate and permit quotes with escorts.' },
      { name: 'Dry Van Basic / Pro', price: '$35 / $129', what: 'Per 3 users a month; Pro adds SONAR insights and broker ratings.' },
      { name: 'Reefer Basic / Pro', price: '$42 / $159', what: 'Per 3 users a month, same feature split as dry van.' },
    ],
    signup: ['Pick a plan on Truckstop’s pricing page.', 'Have an active MC number, a valid DOT number and payment details ready — new authorities can sign up.', 'Pay the application fee; it is credited to your first month when you are approved.'],
    withHaulPanel: HP_LB,
    goodToKnow: ['The application fee is non-refundable — it only counts toward the first month if you are approved.', 'Broker days-to-pay and ratings are not in Basic; they start with Advanced.', 'API access needs Pro, and Truckstop says extra costs and requirements may apply.'],
    faq: [
      ['How much does Truckstop cost for carriers?', 'Listed on November 26, 2026: Basic $42, Advanced $135, Pro $159 per month, fees and taxes excluded. Dry van and reefer plans start at $35 and $42 per 3 users.'],
      ['What do I need to sign up?', 'An active MC number, a valid DOT number and basic contact and payment information. New authorities can sign up.'],
      ['Does Truckstop show broker days to pay?', 'Yes, on Advanced and Pro, with complaint history and broker rating.'],
      ['Where does Truckstop’s rate data come from?', 'Rate Insights (Pro) uses paid invoice data from real loads; Truckstop calls it a planning tool, not a guarantee.'],
      ['Can I change plans?', 'Plans renew monthly. Upgrades take effect right away, downgrades at the next billing cycle.'],
    ],
    sources: ['https://truckstop.com/product/load-board/pricing/', 'https://truckstop.com/product/load-board/carrier/', 'https://truckstop.com/frequently-asked-questions/', 'https://truckstop.com/about/', 'https://developer.truckstop.com/reference/overview'],
  },
  {
    id: '123lb', slug: '123loadboard', updated: UPDATED,
    title: '123Loadboard — Plans from $39, 5-Day Free Trial, No Contract (2026)',
    description: '123Loadboard for owner-operators and small fleets: Standard $39, Premium $59, Premium Plus $79 a month (listed Nov 2026), 5-day free trial, month-to-month, credit and days-to-pay, Rate Check, PC*Miler routing.',
    h1: '123Loadboard: a low-cost load board with a free trial',
    lead: '123Loadboard (since 2004) gives carriers unlimited load search and truck posting from $39 a month, a 5-day free trial on every plan, month-to-month terms, and credit, rate and routing tools on the higher plans.',
    glance: [['Best for', 'Owner-operators, fleets up to 10 trucks'], ['From', '$39/month (Standard)'], ['Credit & days-to-pay', 'From Premium ($59)'], ['Rate data', 'Premium Plus ($79)'], ['Free trial', '5 days, every plan'], ['Contract', 'Month-to-month'], ['Founded', '2004']],
    features: [
      { h: 'Unlimited search and posting', p: 'On every plan, on the web and in the mobile app, with load alerts and live updates.' },
      { h: 'Book and bid in the app', p: 'Bidding, messaging and Book Now, plus document capture and storage.' },
      { h: 'Credit and days-to-pay', p: 'Credit scores and days-to-pay from the Premium plan.' },
      { h: 'Rate Check', p: 'Lane rates, historical trends and Negotiation Strength on Premium Plus.' },
      { h: 'PC*Miler routing', p: 'Maps, routing, tolls and an IFTA mileage calculator on Premium Plus.' },
      { h: 'Quick pay and factoring', p: 'Through partner eCapital: factoring, a digital wallet and load advances. APIs for posting, search and rates.' },
    ],
    pricing: 'Carrier plans as listed on 123loadboard.com on November 26, 2026 (monthly, USD), for fleets of up to 10 trucks. Each plan includes a 5-day free trial; plans are month-to-month with no fees to downgrade or cancel, per 123Loadboard.',
    plans: [
      { name: 'Standard', price: '$39/mo', what: 'Unlimited search and posting, mobile app, alerts, Book Now, document storage.' },
      { name: 'Premium', price: '$59/mo', what: 'Adds backhauls, density map, profit calculator, credit scores & days-to-pay.' },
      { name: 'Premium Plus', price: '$79/mo', what: 'Adds PC*Miler routing & tolls, IFTA calculator, Rate Check and rate trends.' },
    ],
    signup: ['Pick a plan on 123Loadboard’s pricing page — each starts with a 5-day free trial.', 'Create the account with your company details.', 'Cancel or change plans month to month.'],
    withHaulPanel: HP_LB,
    goodToKnow: ['Rate data (Rate Check, trends) is only in Premium Plus ($79).', 'Published prices apply to fleets of up to 10 trucks; larger fleets should ask 123Loadboard.', 'Quick pay and factoring are provided by partner eCapital, not by 123Loadboard itself.'],
    faq: [
      ['How much does 123Loadboard cost?', 'Listed on November 26, 2026: Standard $39, Premium $59, Premium Plus $79 per month, for fleets of up to 10 trucks.'],
      ['Is there a free trial?', 'Yes — each carrier plan includes a 5-day free trial.'],
      ['Is there a contract?', 'No. Plans are month-to-month with no fees to downgrade or unsubscribe, per 123Loadboard.'],
      ['Which plan shows broker credit and days to pay?', 'Premium and Premium Plus. Standard does not include it.'],
      ['Does 123Loadboard offer quick pay or factoring?', 'Yes, through its partner eCapital: factoring, a digital wallet and load advances.'],
    ],
    sources: ['https://www.123loadboard.com/pricing/', 'https://www.123loadboard.com/about/who-we-are/', 'https://www.123loadboard.com/about/our-history/', 'https://www.123loadboard.com/how-it-works/quick-pay/', 'https://www.123loadboard.com/api/'],
  },
];

export const LOADBOARD_COMPARISON: Comparison = {
  slug: 'dat-vs-truckstop-vs-123loadboard', category: 'loadboards', crumb: 'Load boards compared', updated: UPDATED,
  title: 'DAT vs Truckstop vs 123Loadboard — Prices & Features Compared (2026)',
  description: 'DAT One, Truckstop and 123Loadboard compared from their pricing pages (Nov 2026): starting prices, broker credit and days-to-pay, rate data, mobile apps, free trials — and which fits an owner-operator or a fleet.',
  h1: 'DAT vs Truckstop vs 123Loadboard',
  lead: 'The three load boards carriers ask about most, compared from their own pricing pages: what the cheapest plan gets you, where broker credit and rate data start, and who each fits.',
  columns: ['From', 'Broker credit / days-to-pay', 'Rate data', 'Free trial', 'Best for'],
  rows: [
    { id: 'dat', name: 'DAT One', cells: ['$59/mo', 'Every plan', 'From Enhanced ($149)', 'Free account; no paid trial stated', 'Carriers who want broker credit on every plan; fleets'] },
    { id: 'truckstop', name: 'Truckstop', cells: ['$42/mo per user + application fee', 'From Advanced ($135)', 'Pro ($159) — Rate Insights', 'No', 'Dry van, reefer and heavy-haul plans; free TMS'] },
    { id: '123lb', name: '123Loadboard', cells: ['$39/mo', 'From Premium ($59)', 'Premium Plus ($79)', '5 days, every plan', 'Owner-operators and small fleets on a budget'] },
  ],
  sections: [
    { h: 'Which one to pick', p: [
      'On a tight budget, start with 123Loadboard: the lowest published prices, a 5-day free trial and month-to-month terms — but credit data starts at $59 and rate data at $79.',
      'If you want broker credit and days-to-pay on the cheapest plan, DAT One Standard ($59) includes it; lane rates start at Enhanced ($149).',
      'If you haul dry van, reefer or oversize, Truckstop has plans built for each, and Rate Insights on Pro comes from paid invoice data.',
      'Many carriers run two boards. Whatever you use, check every broker before booking — authority, bond and the contact details on file with FMCSA.',
    ] },
  ],
  withHaulPanel: 'Booked a load on any board? Drop the rate con into HaulPanel: the AI makes the load, the BOL and POD attach to it, and the invoice goes to the broker in one click.',
  faq: [
    ['Which load board is cheapest?', 'From the published prices on November 26, 2026: 123Loadboard Standard at $39 a month, then Truckstop Basic at $42 per user, then DAT One Standard at $59.'],
    ['Which load board shows broker days to pay?', 'DAT on every carrier plan; Truckstop from Advanced; 123Loadboard from Premium.'],
    ['Which load boards have a free trial?', '123Loadboard has a 5-day free trial on each plan. DAT offers a free account but no paid-plan trial is stated; Truckstop states no trial.'],
    ['Do I need an MC number for a load board?', 'Truckstop asks for an active MC and DOT number. DAT asks for the DOT number at sign-up and lets you add the MC later.'],
  ],
  sources: ['https://www.dat.com/load-boards/pricing', 'https://truckstop.com/product/load-board/pricing/', 'https://www.123loadboard.com/pricing/', 'https://truckstop.com/frequently-asked-questions/', 'https://www.dat.com/resources/faq'],
};
