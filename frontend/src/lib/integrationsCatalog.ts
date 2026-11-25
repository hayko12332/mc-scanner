// Every company HaulPanel can connect with, for the Integrations page. Honest status per company:
//   live kinds (eld, quickbooks, factoring, telegram, fmcsa) — work today (or once switched on for the account);
//   requested — we asked the company for partner/API access and wait for their answer;
//   planned   — the company has an API or partner program we can use; not built yet.
// Sources: the partner research of 2026-11 (reports/Партнёры и интеграции HaulPanel.md) and the letters sent since.

import type { EldProvider } from './crm'

export type Category = 'hubs' | 'eld' | 'loadboards' | 'brokers' | 'factoring' | 'fuel' | 'tolls' | 'accounting' | 'payments' | 'vetting' | 'insurance' | 'rates' | 'comms' | 'docs' | 'drivers' | 'automation'
export const CATEGORIES: [Category, string][] = [
  ['eld', 'ELD & GPS'], ['hubs', 'Connect hubs'], ['loadboards', 'Load boards'], ['brokers', 'Broker APIs'], ['factoring', 'Factoring'], ['fuel', 'Fuel cards'],
  ['tolls', 'Tolls & mileage'], ['accounting', 'Accounting'], ['payments', 'Payments'], ['vetting', 'Compliance & vetting'],
  ['insurance', 'Insurance'], ['rates', 'Rate data'], ['comms', 'Email, SMS & phone'], ['docs', 'E-signature'], ['drivers', 'Drivers'], ['automation', 'Automation'],
]
export type Kind = 'eld' | 'quickbooks' | 'factoring' | 'telegram' | 'fmcsa' | 'requested' | 'planned'
export interface App {
  id: string; name: string; maker: string; category: Category; tile: string; tint: string; kind: Kind
  blurb: string; does: string[]; reads: string[]; pending?: string; provider?: EldProvider
  /** The company's site — its logo is /logos/<id>.png when we have one. */
  domain?: string
  /** Host of the company's own MCP server: HaulPanel's AI assistant can work in the account through it. */
  mcp?: string
  /** Connect hubs (aggregators) that also reach this company, by id. */
  via?: string[]
  /** For a hub: what it reaches. */
  reaches?: string
}

const REQUESTED = 'We asked them for partner access to their API and are waiting for their answer. Tap “I use it” so we know it matters to you.'
const PLANNED = 'They have an API or a partner program HaulPanel can use — it isn’t built yet. Tap “I use it”: the most-asked integrations are built first.'

/** A company we can connect with but haven't built yet. */
const soon = (kind: 'requested' | 'planned', id: string, name: string, maker: string, category: Category, tile: string, tint: string, blurb: string, does: string[], reads = [`Your ${name} account — only with your permission`]): App =>
  ({ id, name, maker, category, tile, tint, kind, blurb, does, reads, pending: kind === 'requested' ? REQUESTED : PLANNED })

// Hubs that reach many companies at once
const ELD_HUBS = ['terminal', 'truckercloud', 'axle']
const SAAS_HUBS = ['zapier', 'pipedream', 'composio']
const ACCT_HUBS = ['merge', 'codat', 'rutter', ...SAAS_HUBS]
const MAIL_HUBS = ['nylas', ...SAAS_HUBS]

const BASE: App[] = [
  // ELD & GPS
  {
    id: 'samsara', provider: 'samsara', kind: 'eld', name: 'Samsara', maker: 'Samsara Inc.', category: 'eld', tile: 'S', tint: '#0b2a4a',
    blurb: 'Live truck locations, drivers’ hours of service and GPS history on your fleet map.',
    does: ['Every truck on the fleet map, updated every 2 minutes, with speed and heading', 'Drivers’ HOS clocks — drive, shift, cycle, break — on each truck', 'The last 24 hours of GPS trail as soon as you connect', 'Brokers’ tracking links and ETAs use the ELD position', 'Trucks are matched to yours by unit number'],
    reads: ['Vehicles', 'Vehicle statistics (GPS)', 'Drivers', 'ELD compliance (HOS clocks)'],
  },
  {
    id: 'motive', provider: 'motive', kind: 'eld', name: 'Motive', maker: 'Motive Technologies (KeepTruckin)', category: 'eld', tile: 'M', tint: '#1c1c1e',
    blurb: 'Live truck locations and drivers’ available hours from Motive ELDs.',
    does: ['Every truck on the fleet map with speed and heading', 'Drivers’ available drive, shift, cycle and break time', 'Brokers’ tracking links use the ELD position'],
    reads: ['Vehicles', 'Vehicle locations', 'Users (drivers)', 'Available time (HOS)'],
    pending: 'Motive approves partner apps before their API can be used. Our request is in review.',
  },
  soon('planned', 'geotab', 'Geotab', 'Geotab Inc.', 'eld', 'G', '#0b5394', 'Truck locations and HOS from MyGeotab — open SDK, sign in with your MyGeotab user.', ['Trucks on the fleet map', 'Drivers’ duty status and hours left', 'GPS trail for brokers’ tracking links']),
  soon('requested', 'aggregator', 'Terminal · TruckerCloud', 'ELD aggregators', 'eld', '40+', '#334155', 'One connection for 40+ ELD brands your carriers use — Omnitracs, PeopleNet, Verizon and more.', ['Any carrier’s ELD, whatever the brand', 'Locations and HOS on the fleet map', 'Carriers grant access with one consent link']),
  soon('planned', 'verizon', 'Verizon Connect', 'Verizon Connect', 'eld', 'V', '#cd040b', 'Locations and hours of service from Verizon Connect Reveal.', ['Trucks on the fleet map', 'Drivers’ HOS clocks']),
  soon('planned', 'omnitracs', 'Omnitracs', 'Solera', 'eld', 'O', '#00539b', 'Locations and hours from Omnitracs ELDs.', ['Trucks on the fleet map', 'Drivers’ HOS clocks']),
  soon('planned', 'peoplenet', 'Trimble · PeopleNet', 'Trimble Transportation', 'eld', 'T', '#004f9e', 'Locations and hours from PeopleNet and Trimble ELDs.', ['Trucks on the fleet map', 'Drivers’ HOS clocks']),
  soon('planned', 'platformscience', 'Platform Science', 'Platform Science', 'eld', 'PS', '#111827', 'Locations and hours from Platform Science devices.', ['Trucks on the fleet map', 'Drivers’ HOS clocks']),
  soon('planned', 'isaac', 'ISAAC', 'ISAAC Instruments', 'eld', 'I', '#e4002b', 'Locations and hours from ISAAC ELDs.', ['Trucks on the fleet map', 'Drivers’ HOS clocks']),
  soon('planned', 'eroad', 'EROAD', 'EROAD', 'eld', 'E', '#00a3e0', 'Locations and hours from EROAD ELDs.', ['Trucks on the fleet map', 'Drivers’ HOS clocks']),
  soon('planned', 'zonar', 'Zonar', 'Zonar Systems', 'eld', 'Z', '#0067b1', 'Locations and hours from Zonar ELDs.', ['Trucks on the fleet map', 'Drivers’ HOS clocks']),
  soon('planned', 'teletrac', 'Teletrac Navman', 'Teletrac Navman', 'eld', 'TN', '#00843d', 'Locations and hours from Teletrac Navman.', ['Trucks on the fleet map', 'Drivers’ HOS clocks']),

  // Load boards
  soon('requested', 'dat', 'DAT One', 'DAT Freight & Analytics', 'loadboards', 'DAT', '#0046ad', 'Search loads, post trucks and see lane rates without leaving HaulPanel.', ['Load search near your trucks, with their hours left', 'Post trucks', 'Lane rates next to the offer']),
  soon('requested', '123lb', '123Loadboard', '123Loadboard', 'loadboards', '123', '#e85d0c', 'Search loads, post trucks and message brokers from HaulPanel.', ['Load search', 'Post trucks', 'Message brokers and Book Now']),
  soon('requested', 'directfreight', 'Direct Freight', 'Direct Freight Services', 'loadboards', 'DF', '#1d4ed8', 'Loads and truck posting from Direct Freight with your own login.', ['Load search', 'Post trucks']),
  soon('planned', 'truckstop', 'Truckstop', 'Truckstop.com', 'loadboards', 'TS', '#f26b21', 'Load search, truck posting and rate insights from Truckstop.', ['Load search', 'Post trucks', 'Rate insights']),
  soon('planned', 'truckerpath', 'Trucker Path', 'Trucker Path', 'loadboards', 'TP', '#00a651', 'Loads from the Trucker Path load board.', ['Load search', 'Post trucks']),

  // Broker APIs
  soon('planned', 'chrobinson', 'C.H. Robinson', 'C.H. Robinson', 'brokers', 'CHR', '#00609c', 'Available loads, offers and tracking updates straight from C.H. Robinson.', ['Book CHR loads from HaulPanel', 'Send check calls and location updates automatically', 'Get paid faster with documents sent back']),
  soon('planned', 'uberfreight', 'Uber Freight', 'Uber Freight', 'brokers', 'UF', '#000000', 'Loads and tracking updates with Uber Freight.', ['Book loads', 'Automatic tracking updates']),

  // Factoring
  {
    id: 'factoring', kind: 'factoring', name: 'Send to factoring', maker: 'Built into HaulPanel', category: 'factoring', tile: '$', tint: '#7c3aed',
    blurb: 'One PDF to any factoring company: invoice with their “remit to”, rate con, BOL and POD.',
    does: ['Works with every factoring company — by email, nothing to connect', 'The invoice carries the factor’s “remit to” line', 'Rate con, BOL and POD are attached in one PDF', 'The factor’s email is saved on the carrier'],
    reads: ['Nothing outside HaulPanel'],
  },
  soon('requested', 'otr', 'OTR Solutions', 'OTR Solutions', 'factoring', 'OTR', '#0a3d62', 'Submit invoices to OTR and see advances and payments on each load.', ['Send invoices with documents in one tap', 'Advance and payment status on the load']),
  soon('planned', 'apex', 'Apex Capital', 'Apex Capital', 'factoring', 'A', '#c8102e', 'Submit invoices to Apex and see their status in HaulPanel.', ['Send invoices with documents', 'Payment status on the load']),
  soon('planned', 'haulpay', 'HaulPay', 'HaulPay', 'factoring', 'HP', '#00b2a9', 'Invoices and payment status with HaulPay.', ['Send invoices', 'Payment status on the load']),
  soon('planned', 'rts', 'RTS Financial', 'RTS Financial', 'factoring', 'RTS', '#003a70', 'Invoices to RTS and their payment status.', ['Send invoices', 'Payment status on the load']),
  soon('planned', 'triumph', 'Triumph', 'Triumph Financial', 'factoring', 'Tr', '#005eb8', 'Invoices to Triumph and their payment status.', ['Send invoices', 'Payment status on the load']),
  soon('planned', 'tafs', 'TAFS', 'TAFS Inc.', 'factoring', 'TAF', '#e31b23', 'Invoices to TAFS and their payment status.', ['Send invoices', 'Payment status on the load']),
  soon('planned', 'ecapital', 'eCapital', 'eCapital Corp.', 'factoring', 'eC', '#00467f', 'Invoices to eCapital and their payment status.', ['Send invoices', 'Payment status on the load']),
  soon('planned', 'denim', 'Denim', 'Denim (Truckstop)', 'factoring', 'D', '#1f3a68', 'Invoices and payments with Denim.', ['Send invoices', 'Payment status on the load']),

  // Fuel cards
  soon('planned', 'atob', 'AtoB', 'AtoB', 'fuel', 'AB', '#111827', 'Fuel card transactions on each truck, and fuel advances on a load.', ['Fuel spend per truck and per load', 'Fuel advances against a booked load']),
  soon('planned', 'coast', 'Coast', 'Coast', 'fuel', 'C', '#2563eb', 'Fuel card spend per truck and driver.', ['Fuel spend per truck', 'Card limits per driver']),
  soon('planned', 'roadflex', 'RoadFlex', 'RoadFlex', 'fuel', 'RF', '#16a34a', 'Fuel card transactions with your RoadFlex key.', ['Fuel spend per truck']),
  soon('planned', 'efs', 'WEX · EFS', 'WEX Inc.', 'fuel', 'EFS', '#d71920', 'Fuel transactions and money codes from EFS cards.', ['Fuel spend per truck', 'Money codes']),
  soon('planned', 'comdata', 'Comdata', 'Corpay', 'fuel', 'CD', '#0c2340', 'Fuel transactions and Comchecks.', ['Fuel spend per truck', 'Comchecks']),
  soon('planned', 'tcs', 'TCS Fuel', 'TCS Fuel', 'fuel', 'TCS', '#f7941d', 'Fuel transactions from TCS cards.', ['Fuel spend per truck']),

  // Tolls & mileage
  soon('planned', 'bestpass', 'Bestpass', 'Bestpass', 'tolls', 'BP', '#00205b', 'Toll charges matched to each truck and load.', ['Tolls per truck and per load', 'Toll costs in your reports']),
  soon('planned', 'prepass', 'PrePass', 'PrePass', 'tolls', 'PP', '#0070b8', 'Toll and weigh-station bypass data per truck.', ['Tolls per truck']),
  soon('planned', 'tollguru', 'TollGuru', 'TollGuru', 'tolls', 'TG', '#ff6b00', 'Toll cost estimates for a lane before you book it.', ['Toll estimate on each load']),
  soon('planned', 'pcmiler', 'PC*MILER', 'Trimble Maps', 'tolls', 'PC', '#00447c', 'Industry-standard practical miles and truck routes.', ['PC*MILER miles on loads', 'Truck-legal routes on the map']),

  // Accounting
  {
    id: 'quickbooks', kind: 'quickbooks', name: 'QuickBooks Online', maker: 'Intuit', category: 'accounting', tile: 'qb', tint: '#2ca01c',
    blurb: 'Invoices you send appear in QuickBooks; when they’re paid there, the load turns paid here.',
    does: ['Each invoice sent from HaulPanel is created in QuickBooks with the same number', 'Payments recorded in QuickBooks mark the load paid (checked every 4 hours)'],
    reads: ['Customers and invoices (create and read)', 'Payments (read)'],
    pending: 'We’re finishing the QuickBooks connection. Until then, Reports → Export works with QuickBooks import.',
  },
  soon('planned', 'xero', 'Xero', 'Xero', 'accounting', 'X', '#13b5ea', 'Invoices to Xero and payments back to HaulPanel.', ['Invoices created in Xero', 'Paid loads marked paid']),
  soon('planned', 'freshbooks', 'FreshBooks', 'FreshBooks', 'accounting', 'FB', '#0075dd', 'Invoices to FreshBooks and payments back.', ['Invoices created in FreshBooks', 'Paid loads marked paid']),

  // Payments
  soon('planned', 'stripe', 'Stripe', 'Stripe', 'payments', 'S', '#635bff', 'Let brokers and shippers pay your invoices by card or ACH.', ['“Pay now” link on every invoice', 'Paid loads marked paid automatically']),
  soon('planned', 'relay', 'Relay Payments', 'Relay', 'payments', 'R', '#ff5a1f', 'Lumper and fuel payment codes for a load.', ['Lumper payments attached to the load']),
  soon('planned', 'bill', 'BILL', 'BILL', 'payments', 'B', '#ff6a00', 'Pay carriers and vendors from your BILL account.', ['Carrier pay sent from HaulPanel']),

  // Compliance & vetting
  {
    id: 'fmcsa', kind: 'fmcsa', name: 'FMCSA checks', maker: 'Built into HaulPanel', category: 'vetting', tile: 'DOT', tint: '#1e3a8a',
    blurb: 'Authority, insurance, age and revocations of any MC — checked as you type it on a load or carrier.',
    does: ['MC / DOT lookup with authority status', 'Insurance and bond on file', 'Warnings for new or revoked authority', 'Daily list of new MCs (New MC leads)'],
    reads: ['Public FMCSA data only'],
  },
  soon('planned', 'highway', 'Highway', 'Highway', 'vetting', 'H', '#0f172a', 'Carrier identity and fraud checks before you book.', ['Identity and fraud alerts on carriers', 'Onboarding status on the carrier']),
  soon('planned', 'mycarrierpackets', 'MyCarrierPackets', 'MyCarrierPackets', 'vetting', 'MCP', '#1b75bb', 'Carrier packets and monitoring.', ['Carrier packet on the carrier', 'Insurance change alerts']),
  soon('planned', 'rmis', 'RMIS', 'Truckstop', 'vetting', 'RM', '#00558c', 'Carrier onboarding and compliance monitoring.', ['Onboarding status', 'Compliance alerts']),
  soon('planned', 'carrierassure', 'Carrier Assure', 'Carrier Assure', 'vetting', 'CA', '#00a3ad', 'Carrier risk scores.', ['Risk score on the carrier']),
  soon('planned', 'saferwatch', 'SaferWatch', 'SaferWatch', 'vetting', 'SW', '#d62828', 'Carrier monitoring and alerts.', ['Authority and insurance change alerts']),

  // Insurance
  soon('planned', 'nextins', 'NEXT Insurance', 'NEXT', 'insurance', 'N', '#2f80ed', 'Business insurance for dispatch companies, quoted online.', ['General liability and E&O quotes']),
  soon('planned', 'coverwhale', 'Cover Whale', 'Cover Whale', 'insurance', 'CW', '#0077c8', 'Truck insurance quotes for your carriers.', ['Auto liability and cargo quotes']),
  soon('planned', 'reliance', 'Reliance Partners', 'Reliance Partners', 'insurance', 'RP', '#14213d', 'Truck insurance for new and growing carriers.', ['Quotes for your carriers']),
  soon('planned', 'luckytruck', 'LuckyTruck', 'LuckyTruck', 'insurance', 'LT', '#f59e0b', 'Truck insurance for new authorities.', ['Quotes for your carriers']),

  // Rate data
  soon('planned', 'sonar', 'SONAR', 'FreightWaves', 'rates', 'SO', '#0a2540', 'Market rates and capacity by lane.', ['Market rate next to each offer']),
  soon('planned', 'greenscreens', 'Greenscreens.ai', 'Greenscreens.ai', 'rates', 'GS', '#00a86b', 'AI rate predictions for a lane.', ['Predicted buy / sell rate on each load']),

  // Email, SMS & phone
  soon('planned', 'gmail', 'Gmail', 'Google', 'comms', 'Gm', '#ea4335', 'Send invoices and rate cons from your own Gmail; rate cons you receive become loads.', ['Emails go from your address', 'Rate cons from your inbox become loads'], ['Send email', 'Read only messages with rate cons — with your permission']),
  soon('planned', 'outlook', 'Outlook · Microsoft 365', 'Microsoft', 'comms', 'Ol', '#0078d4', 'Send from your Outlook address; rate cons you receive become loads.', ['Emails go from your address', 'Rate cons from your inbox become loads'], ['Send email', 'Read only messages with rate cons — with your permission']),
  soon('planned', 'twilio', 'SMS · Twilio', 'Twilio', 'comms', 'SMS', '#f22f46', 'Text drivers and brokers from HaulPanel.', ['Load details to the driver by SMS', 'Check calls by text']),
  soon('planned', 'ringcentral', 'RingCentral', 'RingCentral', 'comms', 'RC', '#ff8800', 'Call and log calls with brokers from the load.', ['Click to call', 'Calls logged on the load']),

  // E-signature
  soon('planned', 'docusign', 'DocuSign', 'DocuSign', 'docs', 'DS', '#4c00ff', 'Carrier agreements and rate cons signed online.', ['Send a rate con for signature', 'Signed copy saved on the load']),
  soon('planned', 'boldsign', 'BoldSign', 'Syncfusion', 'docs', 'BS', '#e8562a', 'Low-cost e-signature for dispatch agreements.', ['Dispatch agreements signed online']),

  // Drivers
  {
    id: 'telegram', kind: 'telegram', name: 'Driver app on Telegram', maker: 'Built into HaulPanel', category: 'drivers', tile: '✈', tint: '#229ed9',
    blurb: 'Drivers share their location and send BOL / POD photos from Telegram — no app to install.',
    does: ['Live location from the driver’s phone when a truck has no ELD', 'BOL and POD photos go straight onto the load', 'The driver marks the load loaded or delivered'],
    reads: ['Only what the driver chooses to share'],
  },

  // Automation
  soon('planned', 'zapier', 'Zapier', 'Zapier', 'automation', 'Z', '#ff4f00', 'Connect HaulPanel to 7,000+ apps — new load, status change, invoice paid.', ['Triggers: load added, status changed, invoice paid', 'Actions: add a load, add a carrier']),
  soon('planned', 'make', 'Make', 'Make', 'automation', 'Mk', '#6d00cc', 'Automate HaulPanel with Make scenarios.', ['Triggers and actions like Zapier']),
]

/** A connect hub: one integration that reaches many companies. */
const hub = (kind: 'requested' | 'planned', id: string, name: string, maker: string, tile: string, tint: string, reaches: string, blurb: string, does: string[]): App =>
  ({ ...soon(kind, id, name, maker, 'hubs', tile, tint, blurb, does, ['Only the accounts you choose to connect through it']), reaches })

const MORE: App[] = [
  // Connect hubs — one integration, many companies
  hub('planned', 'terminal', 'Terminal', 'Terminal (YC)', 'Tm', '#111827', 'Hundreds of ELD and telematics brands', 'The “Plaid for telematics”: one connection reaches Samsara, Motive, Geotab, Omnitracs and hundreds of smaller ELDs.', ['Your carriers connect any ELD with one consent link', 'Locations, HOS and vehicles in one format', 'No separate partner deal with each ELD']),
  hub('requested', 'truckercloud', 'TruckerCloud', 'TruckerCloud', 'TC', '#0ea5e9', '40+ ELD brands', 'ELD data from 40+ providers through one API — used by insurers and brokers.', ['Carrier consent once, data from their ELD', 'Locations and HOS']),
  hub('planned', 'axle', 'Axle', 'Axle Technologies', 'Ax', '#4f46e5', 'ELDs and fleet systems', 'Unified API for ELD and fleet data.', ['Locations and HOS from many ELDs']),
  hub('planned', 'zapier', 'Zapier', 'Zapier', 'Z', '#ff4f00', '8,000+ apps, incl. Samsara and Motive', 'Zapier’s MCP server lets HaulPanel’s AI take actions in 8,000+ apps you connect in Zapier.', ['Your Zapier apps as tools for HaulPanel’s AI', 'Triggers: load added, status changed, invoice paid', 'Actions: add a load, add a carrier']),
  hub('planned', 'make', 'Make', 'Make', 'Mk', '#6d00cc', '2,000+ apps', 'Run your Make scenarios from HaulPanel and its AI.', ['Make scenarios as tools for HaulPanel’s AI']),
  hub('planned', 'pipedream', 'Pipedream Connect', 'Pipedream', 'Pd', '#22c55e', '3,000+ APIs', 'One connection layer for 3,000+ APIs with sign-in handled for you — Gmail, QuickBooks, Stripe, Slack and more.', ['Connect accounts with their own sign-in', 'Each connected app becomes a tool for HaulPanel’s AI']),
  hub('planned', 'composio', 'Composio', 'Composio', 'Co', '#0f172a', '1,000+ apps for AI agents', 'Ready-made, signed-in tools for AI agents across 1,000+ apps.', ['Gmail, Outlook, QuickBooks, Stripe, DocuSign and more as AI tools']),
  hub('planned', 'merge', 'Merge', 'Merge API', 'Me', '#000000', 'QuickBooks, Xero, NetSuite, FreshBooks and more', 'One accounting API for every accounting system your carriers use.', ['Invoices and payments in any accounting system']),
  hub('planned', 'codat', 'Codat', 'Codat', 'Cd', '#1b1f3b', 'Accounting, banking and commerce systems', 'Accounting and banking data from many systems through one API.', ['Invoices and payments in any accounting system']),
  hub('planned', 'rutter', 'Rutter', 'Rutter', 'Ru', '#0b0b0b', 'Accounting and commerce platforms', 'Unified accounting and commerce API.', ['Invoices and payments in any accounting system']),
  hub('planned', 'nylas', 'Nylas', 'Nylas', 'Ny', '#1d4ed8', 'Gmail, Outlook, Exchange, IMAP', 'Every mailbox through one API: send from your own address, rate cons in your inbox become loads.', ['Emails go from your own address', 'Rate cons from your inbox become loads']),

  // More companies with their own MCP servers or APIs
  soon('planned', 'paypal', 'PayPal', 'PayPal', 'payments', 'PP', '#003087', 'Send invoices brokers can pay with PayPal; payments mark loads paid.', ['PayPal invoices', 'Paid loads marked paid']),
  soon('planned', 'square', 'Square', 'Block', 'payments', 'Sq', '#111111', 'Square invoices and payments.', ['Square invoices', 'Paid loads marked paid']),
  soon('planned', 'plaid', 'Plaid', 'Plaid', 'payments', 'Pl', '#111111', 'See incoming broker payments in your bank account and match them to loads.', ['Bank deposits matched to invoices', 'Paid loads marked paid']),
  soon('planned', 'gdrive', 'Google Drive & Sheets', 'Google', 'docs', 'GD', '#0f9d58', 'Save rate cons, BOLs and PODs to Drive; export loads to a live Sheet.', ['Documents saved to Drive folders', 'Loads in a Google Sheet that stays current']),
  soon('planned', 'flexport', 'Flexport', 'Flexport', 'brokers', 'Fx', '#0b1f3a', 'Quote, book and track freight on Flexport.', ['Quotes and bookings', 'Shipment tracking']),
  soon('planned', 'shipwell', 'Shipwell', 'Shipwell', 'brokers', 'Sw', '#2b59c3', 'Shipments, carriers and invoices from shippers who use Shipwell.', ['Tenders from Shipwell shippers', 'Status and invoices back']),
]

/** Sites (for logos), official MCP servers, and the hubs that reach each company. */
const META: Record<string, Partial<App>> = {
  samsara: { domain: 'samsara.com', mcp: 'mcp.samsara.com', via: [...ELD_HUBS, 'zapier'] },
  motive: { domain: 'gomotive.com', mcp: 'mcp.us.gomotive.com', via: [...ELD_HUBS, 'zapier'] },
  geotab: { domain: 'geotab.com', mcp: 'mcp.geotab.com', via: ELD_HUBS },
  verizon: { domain: 'verizonconnect.com', via: ELD_HUBS }, omnitracs: { domain: 'omnitracs.com', via: ELD_HUBS },
  peoplenet: { domain: 'trimble.com', via: ELD_HUBS }, platformscience: { domain: 'platformscience.com', via: ELD_HUBS },
  isaac: { domain: 'isaacinstruments.com', via: ELD_HUBS }, eroad: { domain: 'eroad.com', via: ELD_HUBS },
  zonar: { domain: 'zonarsystems.com', via: ELD_HUBS }, teletrac: { domain: 'teletracnavman.com', via: ELD_HUBS },
  aggregator: { domain: 'withterminal.com' },
  dat: { domain: 'dat.com' }, '123lb': { domain: '123loadboard.com' }, directfreight: { domain: 'directfreight.com' },
  truckstop: { domain: 'truckstop.com', mcp: 'mcp.truckstop.com' }, truckerpath: { domain: 'truckerpath.com' },
  chrobinson: { domain: 'chrobinson.com' }, uberfreight: { domain: 'uberfreight.com' }, flexport: { domain: 'flexport.com', mcp: 'Flexport MCP' }, shipwell: { domain: 'shipwell.com', mcp: 'Shipwell MCP' },
  otr: { domain: 'otrsolutions.com' }, apex: { domain: 'apexcapitalcorp.com' }, haulpay: { domain: 'haulpay.io' }, rts: { domain: 'rtsfinancial.com' },
  triumph: { domain: 'triumph.io' }, tafs: { domain: 'tafs.com' }, ecapital: { domain: 'ecapital.com' }, denim: { domain: 'denim.com' },
  atob: { domain: 'atob.com' }, coast: { domain: 'coastpay.com' }, roadflex: { domain: 'roadflex.com' }, efs: { domain: 'wexinc.com' }, comdata: { domain: 'comdata.com' }, tcs: { domain: 'tcsfuel.com' },
  bestpass: { domain: 'bestpass.com' }, prepass: { domain: 'prepass.com' }, tollguru: { domain: 'tollguru.com' }, pcmiler: { domain: 'maps.trimble.com' },
  quickbooks: { domain: 'quickbooks.intuit.com', mcp: 'Intuit QuickBooks MCP', via: ACCT_HUBS }, xero: { domain: 'xero.com', mcp: 'Xero MCP', via: ACCT_HUBS }, freshbooks: { domain: 'freshbooks.com', via: ACCT_HUBS },
  stripe: { domain: 'stripe.com', mcp: 'mcp.stripe.com', via: SAAS_HUBS }, paypal: { domain: 'paypal.com', mcp: 'mcp.paypal.com', via: SAAS_HUBS }, square: { domain: 'squareup.com', mcp: 'mcp.squareup.com', via: SAAS_HUBS },
  plaid: { domain: 'plaid.com', mcp: 'Plaid MCP' }, relay: { domain: 'relaypayments.com' }, bill: { domain: 'bill.com', via: SAAS_HUBS },
  fmcsa: { domain: 'fmcsa.dot.gov' },
  highway: { domain: 'highway.com' }, mycarrierpackets: { domain: 'mycarrierpackets.com' }, rmis: { domain: 'rmis.com' }, carrierassure: { domain: 'carrierassure.com' }, saferwatch: { domain: 'saferwatch.com' },
  nextins: { domain: 'nextinsurance.com' }, coverwhale: { domain: 'coverwhale.com' }, reliance: { domain: 'reliancepartners.com' }, luckytruck: { domain: 'luckytruck.com' },
  sonar: { domain: 'freightwaves.com' }, greenscreens: { domain: 'greenscreens.ai' },
  gmail: { domain: 'gmail.com', mcp: 'gmailmcp.googleapis.com', via: MAIL_HUBS }, outlook: { domain: 'outlook.com', via: MAIL_HUBS },
  twilio: { domain: 'twilio.com', via: SAAS_HUBS }, ringcentral: { domain: 'ringcentral.com', via: SAAS_HUBS },
  docusign: { domain: 'docusign.com', mcp: 'mcp.docusign.com', via: SAAS_HUBS }, boldsign: { domain: 'boldsign.com' }, gdrive: { domain: 'drive.google.com', mcp: 'Google Workspace MCP', via: SAAS_HUBS },
  telegram: { domain: 'telegram.org' },
  terminal: { domain: 'withterminal.com' }, truckercloud: { domain: 'truckercloud.com' }, axle: { domain: 'axleapi.com' },
  zapier: { domain: 'zapier.com', mcp: 'Zapier MCP' }, make: { domain: 'make.com', mcp: 'Make MCP' }, pipedream: { domain: 'pipedream.com', mcp: 'Pipedream MCP' }, composio: { domain: 'composio.dev', mcp: 'Composio MCP' },
  merge: { domain: 'merge.dev' }, codat: { domain: 'codat.io' }, rutter: { domain: 'rutter.com' }, nylas: { domain: 'nylas.com' },
}

export const APPS: App[] = [...BASE, ...MORE]
  // The old “Terminal · TruckerCloud” card is replaced by the two hubs; Zapier / Make move to the hubs.
  .filter((a) => !(a.id === 'aggregator' || (a.category === 'automation' && (a.id === 'zapier' || a.id === 'make'))))
  .map((a) => ({ ...a, ...META[a.id] }))
export const appById = (id: string) => APPS.find((a) => a.id === id)


/** Companies whose logo is in /logos (downloaded once from their site icon; the others show their initials). */
export const LOGOS = new Set('123lb,apex,atob,axle,bestpass,bill,boldsign,carrierassure,chrobinson,coast,codat,comdata,composio,coverwhale,dat,denim,directfreight,docusign,ecapital,efs,eroad,flexport,fmcsa,freshbooks,gdrive,gmail,greenscreens,haulpay,highway,isaac,luckytruck,make,merge,motive,nextins,otr,outlook,paypal,pcmiler,peoplenet,pipedream,plaid,platformscience,prepass,quickbooks,relay,reliance,rmis,roadflex,rutter,samsara,shipwell,sonar,stripe,tafs,tcs,telegram,teletrac,terminal,tollguru,triumph,truckercloud,truckerpath,truckstop,twilio,uberfreight,verizon,xero,zapier,zonar'.split(','))

/**
 * Companies with an app on Zapier (zapier.com/apps/<app>, checked 2026-11-25): the owner connects their own Zapier
 * once (Integrations → Zapier) and turns on that app's actions there; HaulPanel's AI then works in it.
 */
export const ON_ZAPIER = new Set(['samsara', 'motive', 'quickbooks', 'xero', 'freshbooks', 'stripe', 'paypal', 'square', 'gmail', 'outlook', 'gdrive', 'docusign', 'boldsign', 'twilio', 'ringcentral'])
