import { esc, FEATURE_LINKS, page, SITE } from './layout.js';

// Feature pages, one per search intent ("freight broker TMS", "truck dispatch software", "rate confirmation AI",
// "BOL POD software"). Plain, honest copy about what HaulPanel does today — no invented numbers or reviews.

interface Feature {
  title: string;
  description: string;
  kicker: string;
  h1: string;
  lead: string;
  image: string;
  imageAlt: string;
  cards: { icon: string; h: string; p: string; points?: string[] }[];
  steps: [string, string][];
  faq: [string, string][];
}

export const FEATURES: Record<string, Feature> = {
  '/truck-dispatch-software': {
    title: 'Free Truck Dispatch Software with an AI Assistant | HaulPanel',
    description: 'Truck dispatch software for dispatch companies: loads, trucks and drivers, rate per mile, carrier statements, invoices and factoring — with an AI assistant that does the paperwork. Free during beta.',
    kicker: 'For truck dispatch companies',
    h1: 'Truck dispatch software that does the paperwork for you',
    lead: 'Every load from booking to payment on one board — and an AI assistant that turns rate cons into loads, files BOLs and PODs, and prepares invoices for you to approve.',
    image: '/auth-board.jpg',
    imageAlt: 'HaulPanel dispatch board: loads by week with lane, miles, rate per mile, carrier, truck and status',
    cards: [
      { icon: '▦', h: 'One board for every load', p: 'Broker, load number, lane with loaded and empty miles, truck and driver, rate per mile and status — grouped by week, with gross and unpaid totals.' },
      { icon: '$', h: 'Carrier statements in one click', p: 'Each carrier’s dispatch fee as a percent of gross or a flat weekly amount, weekly statement PDFs, and every dispatcher’s pay by their percent.' },
      { icon: '✉', h: 'Invoices and factoring', p: 'Email the invoice with the rate con, BOL and POD in one PDF, get polite reminders sent while it’s unpaid, or send the packet to the carrier’s factoring company.' },
      { icon: '✦', h: 'AI assistant', p: 'Ask in plain words: “invoice everything delivered this week”, “which truck fits this load”, “check MC 1188808”. It does the work; emails wait for your OK.' },
      { icon: '⌖', h: 'Trucks on the map', p: 'Live location and hours of service from Samsara, or the driver’s location from our Telegram bot — and a tracking link for the broker.' },
      { icon: '⇪', h: 'Bring your spreadsheet', p: 'Drop your Excel or Google Sheets load log, carrier list or old TMS export: AI maps the columns and you check the preview before anything is saved.' },
    ],
    steps: [['Create a free account', 'Name, company and MC number — the rest fills in from FMCSA.'], ['Bring your loads in', 'Drop rate cons, spreadsheets or screenshots; AI puts them on the board.'], ['Work from one panel', 'Book, track, invoice and pay out carriers — with the AI doing the typing.']],
    faq: [
      ['Is HaulPanel really free?', 'Yes — HaulPanel is free during beta, with no credit card. If we introduce paid plans later, we will tell you before anything is billed.'],
      ['Who is it for?', 'Truck dispatch services that book loads from brokers for their carriers. Freight brokers have their own mode — see the freight broker TMS page.'],
      ['Can I import my current loads?', 'Yes. Excel, CSV, Google Sheets and exports or screenshots of other TMSs work. AI reads the columns and you review everything before it is saved.'],
      ['Does it work with ELDs and factoring companies?', 'Samsara connects with the carrier’s API token for live location and hours of service. Invoice packets can be emailed to any factoring company.'],
      ['Does the AI send emails on its own?', 'No. The assistant makes board changes you can undo, but every email — invoices, factoring packets, messages to brokers — waits for your OK.'],
    ],
  },
  '/freight-broker-tms': {
    title: 'Freight Broker TMS — Customers, Carrier Pay & Margin, with AI | HaulPanel',
    description: 'A simple TMS for freight brokers: customers, carrier pay and margin on every load, rate confirmations emailed to carriers, invoices to customers, carrier checks and BOL/POD handling. Free during beta.',
    kicker: 'For freight brokers',
    h1: 'A freight broker TMS that keeps the margin in view',
    lead: 'Customer rate, carrier pay and margin on every load. Rate confirmations to carriers in one click, invoices to customers in your name, and an AI assistant that handles the documents.',
    image: '/feature-broker.jpg',
    imageAlt: 'HaulPanel in freight broker mode: customers, carriers, margin on every load and what is owed to carriers',
    cards: [
      { icon: '%', h: 'Margin on every load', p: 'Enter the customer rate and the carrier pay; margin and margin % show on the load, on the board and in reports. Agents are paid a percent of the margin.' },
      { icon: '✍', h: 'Rate cons to carriers', p: 'A clean rate confirmation PDF with the lane, dates, carrier pay, instructions and a signature line — emailed to the carrier, with a copy kept on the load.' },
      { icon: '✉', h: 'Invoices to customers', p: 'Invoice the customer in your company’s name with the BOL and POD attached. The carrier’s rate con never goes to the customer.' },
      { icon: '☰', h: 'Customers in one list', p: 'Revenue, margin, open invoices and how fast each customer pays, built from your loads — no separate CRM to keep up to date.' },
      { icon: '⇄', h: 'Owed to carriers', p: 'See what you owe carriers for delivered loads and mark them paid. Delivered, invoiced and paid are tracked separately for customers and carriers.' },
      { icon: '✓', h: 'Carrier checks', p: 'Check any carrier by MC or USDOT before you book: authority, insurance on file and other companies sharing its phone or email.' },
    ],
    steps: [['Sign up as a freight broker', 'Choose “Freight broker” — the board switches to customers, carrier pay and margin.'], ['Book a load', 'Customer, lane, customer rate, carrier and carrier pay — or drop the customer’s order and let AI fill it in.'], ['Send the paperwork', 'Rate con to the carrier, invoice with POD to the customer, payment tracked on both sides.']],
    faq: [
      ['Is this a full enterprise brokerage TMS?', 'No — HaulPanel is built for small brokerages that want the essentials done fast: loads, margin, rate cons, invoices, documents and carrier checks. It is free during beta.'],
      ['Do you store payment card or bank details?', 'No. HaulPanel tracks amounts and dates; payments themselves stay with your bank or accounting software.'],
      ['Can agents work on the same board?', 'Yes. Invite each agent by email; agents see their own loads and their pay as a percent of the margin.'],
      ['Can I switch from dispatcher mode?', 'Yes — click your company name in the sidebar and choose Freight broker.'],
    ],
  },
  '/rate-confirmation-ai': {
    title: 'Rate Confirmation Reader — AI Turns Rate Cons into Loads | HaulPanel',
    description: 'Drop a rate confirmation PDF or photo and AI reads the broker, load number, pickup and delivery, dates and rate into a new load in seconds. Part of HaulPanel, free during beta.',
    kicker: 'AI rate confirmation reader',
    h1: 'Drop a rate con. The load is on your board.',
    lead: 'HaulPanel’s AI reads rate confirmations — PDFs or phone photos — and fills in the broker, MC, load number, pickup and delivery, dates, rate and notes. You check it and save.',
    image: '/haulpanel-demo.jpg',
    imageAlt: 'HaulPanel new load form filled from a rate confirmation',
    cards: [
      { icon: '⇪', h: 'PDF or photo', p: 'Works with broker rate cons as PDFs and with photos taken on a phone. Several pages and extra stops are fine.' },
      { icon: '✦', h: 'The fields that matter', p: 'Broker name and MC, billing email, load number, first pickup and last delivery, dates, total pay, miles and the appointment and reference notes.' },
      { icon: '📎', h: 'Kept with the load', p: 'The rate con is attached to the load, ready to go out with the invoice in one PDF.' },
      { icon: '✓', h: 'Broker checked', p: 'The broker’s MC is checked with FMCSA as soon as it is read — authority and bond on file.' },
    ],
    steps: [['Open “New load”', 'Or just drop the file into the AI chat.'], ['Drop the rate con', 'AI reads it in a few seconds.'], ['Check and save', 'Fix anything unclear; the file stays with the load.']],
    faq: [
      ['Which rate confirmations does it read?', 'Any broker’s rate con as a PDF, JPEG or PNG up to 10 MB, including phone photos. If something isn’t printed on it, the field is left empty for you.'],
      ['Is my document used to train AI?', 'No. Documents are sent to our AI provider only to read them for you and are not used to train models.'],
      ['Does it work for brokers too?', 'Yes — on a freight broker board it reads your customer’s order or tender into a new load the same way.'],
    ],
  },
  '/bol-pod-software': {
    title: 'BOL & POD Software — AI Files Every Document to Its Load | HaulPanel',
    description: 'Drop a stack of BOLs and PODs: AI reads load numbers, lanes and dates, finds the right load, checks the receiver’s signature, notes shortages and damage, and marks signed PODs delivered.',
    kicker: 'BOL & POD processing',
    h1: 'Drop the BOLs and PODs. AI files each one to its load.',
    lead: 'No more renaming photos and hunting for the right load. HaulPanel reads every bill of lading and proof of delivery, matches it to the load and marks signed PODs delivered — ready to invoice.',
    image: '/feature-bol-pod.jpg',
    imageAlt: 'HaulPanel BOL and POD upload: each POD matched to its load, receiver signature and shortage noted',
    cards: [
      { icon: '⧉', h: 'A whole stack at once', p: 'Drop as many PDFs and phone photos as you have. Each one is read on its own and shown with what was found.' },
      { icon: '⌕', h: 'Matched to the right load', p: 'Load, PRO, BOL and PO numbers settle it; otherwise the pickup and delivery cities and dates point to the load. Unsure? You pick.' },
      { icon: '✍', h: 'Signature and exceptions', p: 'It checks that the receiver signed and notes shortages, damage or refusals — and keeps them in the load’s notes.' },
      { icon: '✓', h: 'Delivered, ready to invoice', p: 'A signed POD marks the load delivered. The invoice goes out with the rate con, BOL and POD in one PDF.' },
      { icon: '✈', h: 'From drivers too', p: 'Drivers can send the POD photo to our Telegram bot; it lands on their load and marks it delivered.' },
      { icon: '✦', h: 'Or just ask the AI', p: 'Send a POD in the AI chat and it finds the load, attaches it and updates the status — and tells you if a signature is missing.' },
    ],
    steps: [['Click “BOL / POD”', 'On the Loads page.'], ['Drop the documents', 'PDFs or photos, as many as you have.'], ['Check and save', 'Each document goes to its load; signed PODs mark loads delivered.']],
    faq: [
      ['What if a document matches the wrong load?', 'Nothing is saved until you press Save. Every document shows the load it was matched to and why, and you can pick another load.'],
      ['What does it read from a POD?', 'Reference numbers, shipper and consignee, cities, pickup and delivery dates, pieces and weight, whether the receiver signed, and any exceptions written on it.'],
      ['Is it only for brokers?', 'No — dispatch companies and freight brokers both use it.'],
    ],
  },
};

/** A feature page, or null for other paths. */
export function featurePage(path: string): string | null {
  const f = FEATURES[path];
  if (!f) return null;
  const others = FEATURE_LINKS.filter(([p]) => p !== path);
  const body = `<div class="wrap"><div class="hero">
<div><span class="kicker">✦ ${esc(f.kicker)}</span><h1>${esc(f.h1)}</h1><p class="lead">${esc(f.lead)}</p>
<div class="actions"><a class="btn primary big" href="/#/crm?signup">Start free</a><a class="btn big" href="/#/crm?demo=1">Open the demo board</a></div>
<p class="note">Free during beta · No credit card · Set up in minutes</p></div>
<div class="shot"><img src="${esc(f.image)}" alt="${esc(f.imageAlt)}" width="${f.image === '/haulpanel-demo.jpg' ? 1280 : 1600}" height="${f.image === '/haulpanel-demo.jpg' ? 720 : 941}" loading="eager"></div>
</div></div>
<div class="band"><div class="wrap"><h2>What you get</h2><div class="grid3" style="margin-top:20px">
${f.cards.map((c) => `<div class="card"><div class="ico" aria-hidden="true">${esc(c.icon)}</div><h3>${esc(c.h)}</h3><p class="muted">${esc(c.p)}</p></div>`).join('')}
</div></div></div>
<section class="pad"><div class="wrap"><h2>How it works</h2><ol class="steps" style="margin-top:20px">
${f.steps.map(([h, p]) => `<li><h3>${esc(h)}</h3><p class="muted">${esc(p)}</p></li>`).join('')}
</ol></div></section>
<div class="band"><div class="wrap" style="max-width:820px"><h2>Questions</h2>
${f.faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}
</div></div>
<section class="final"><div class="wrap"><h2>Try HaulPanel free</h2><p class="lead" style="margin:0 auto">The AI TMS for truck dispatchers and freight brokers.</p>
<div class="actions"><a class="btn primary big" href="/#/crm?signup">Create a free account</a><a class="btn big" href="/#/crm?demo=1">Open the demo board</a></div>
<p class="note">Also: ${others.map(([p, l]) => `<a href="${p}">${esc(l)}</a>`).join(' · ')} · <a href="/mc-number-lookup">MC number lookup</a></p></div></section>`;
  return page({
    path, title: f.title, description: f.description, body, image: SITE + f.image, imageSize: f.image === '/haulpanel-demo.jpg' ? [1280, 720] : [1600, 941],
    jsonLd: [
      { '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: 'HaulPanel', url: SITE + path, applicationCategory: 'BusinessApplication', operatingSystem: 'Web browser',
        description: f.description, offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD', description: 'Free during beta' }, screenshot: SITE + f.image },
      { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: f.faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
    ],
  });
}
