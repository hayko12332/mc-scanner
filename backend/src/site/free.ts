import { esc, page, SITE } from './layout.js';
import { goHref, PARTNER_CATEGORIES, partner, PARTNERS, type Partner } from './partners.js';
import { profilePath } from './partner-pages.js';
import { COMPARISONS, PROFILES } from './partner-profiles.js';

// Free tools and guides for dispatchers, carriers and brokers: calculators and document templates that work right
// in the page (nothing is sent anywhere), and plain guides. They answer what people search for and lead to the TMS.

type Kind = 'tool' | 'guide';
interface FreePage {
  kind: Kind;
  /** Short name for lists and the footer. */
  name: string;
  title: string;
  description: string;
  h1: string;
  lead: string;
  /** The tool (form + result) or the guide's text, as HTML. */
  body: string;
  /** Script for the tool (plain JS, runs in the page). */
  script?: string;
  faq: [string, string][];
  /** How the TMS does the same thing for you. */
  upsell: string;
  /** Services that help with this (partner ids), shown under the tool. */
  partners?: string[];
}

const PUBLISHED = '2026-11-26';

// ---------- small HTML helpers for the forms ----------

const field = (k: string, label: string, value = '', type = 'text', extra = '') =>
  `<label class="fld"><span>${esc(label)}</span><input data-k="${k}" type="${type}" value="${esc(value)}"${type === 'number' ? ' inputmode="decimal" step="any"' : ''}${extra}></label>`;
const area = (k: string, label: string, value = '') => `<label class="fld wide"><span>${esc(label)}</span><textarea data-k="${k}" rows="2">${esc(value)}</textarea></label>`;
const group = (title: string, inner: string) => `<fieldset><legend>${esc(title)}</legend><div class="fgrid">${inner}</div></fieldset>`;

/** Shared client code: read the form, money format, escaping, print. */
const BASE_JS = `
var $ = function (s) { return document.querySelector(s); };
function val(k) { var el = document.querySelector('[data-k="' + k + '"]'); return el ? el.value.trim() : ''; }
function num(k) { var v = parseFloat(val(k).replace(/[$,\\s]/g, '')); return isFinite(v) ? v : 0; }
function usd(n) { return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function h(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function br(s) { return h(s).replace(/\\n/g, '<br>'); }
function on(fn) { document.querySelectorAll('[data-k]').forEach(function (el) { el.addEventListener('input', fn); }); fn(); }
var pb = document.getElementById('print'); if (pb) pb.addEventListener('click', function () { window.print(); });
`;

const docTools = `<div class="doc-actions"><button class="btn primary" id="print" type="button">Download PDF / Print</button><span class="note">In the print window choose “Save as PDF”. Nothing you type leaves your browser.</span></div>`;

// ---------- the pages ----------

export const FREE: Record<string, FreePage> = {
  '/rate-per-mile-calculator': {
    kind: 'tool', name: 'Rate per mile calculator',
    title: 'Trucking Rate Per Mile Calculator — With Deadhead, Fuel & Dispatch Fee',
    description: 'Free rate per mile calculator for truckers and dispatchers: loaded and all-in RPM with deadhead, fuel cost, dispatch fee and what the load really nets per mile. Also finds the rate you need for a target RPM.',
    h1: 'Rate per mile calculator',
    lead: 'Is this load worth it? Enter the rate and the miles — see loaded and all-in rate per mile, fuel, the dispatch fee and what is left per mile.',
    body: `<div class="tool">
<form class="tool-form" onsubmit="return false">
${group('The load', field('rate', 'Linehaul rate, $', '2400', 'number') + field('extra', 'Detention, lumper, other pay, $', '0', 'number') + field('loaded', 'Loaded miles', '920', 'number') + field('dead', 'Deadhead (empty) miles', '80', 'number'))}
${group('Your costs', field('fuel', 'Diesel price, $/gal', '3.75', 'number') + field('mpg', 'Truck MPG', '6.5', 'number') + field('fee', 'Dispatch fee, % of gross', '8', 'number') + field('tolls', 'Tolls and other trip costs, $', '0', 'number'))}
${group('Target', field('target', 'Your target all-in RPM, $', '2.50', 'number'))}
</form>
<div class="tool-out" id="out" aria-live="polite"></div>
</div>`,
    script: `${BASE_JS}
on(function () {
  var gross = num('rate') + num('extra'), loaded = num('loaded'), dead = num('dead'), total = loaded + dead;
  var gal = num('mpg') > 0 ? total / num('mpg') : 0, fuel = gal * num('fuel'), fee = gross * num('fee') / 100, tolls = num('tolls');
  var net = gross - fuel - fee - tolls;
  var need = num('target') * total;
  var rows = [
    ['Loaded RPM', loaded ? usd(gross / loaded) + ' /mi' : '—', 'gross ÷ loaded miles'],
    ['All-in RPM', total ? usd(gross / total) + ' /mi' : '—', 'gross ÷ (loaded + deadhead)'],
    ['Deadhead', total ? Math.round(dead / total * 100) + '%' : '—', dead.toLocaleString('en-US') + ' empty of ' + total.toLocaleString('en-US') + ' total miles'],
    ['Fuel', usd(fuel), gal ? Math.round(gal).toLocaleString('en-US') + ' gal' : ''],
    ['Dispatch fee', usd(fee), num('fee') + '% of ' + usd(gross)],
    ['Left after fuel, fee, tolls', usd(net), total ? usd(net / total) + ' per mile driven' : ''],
  ];
  $('#out').innerHTML = '<div class="big-num"><small>All-in rate per mile</small><b>' + (total ? usd(gross / total) : '—') + '</b></div>'
    + '<dl class="res">' + rows.map(function (r) { return '<div><dt>' + r[0] + '</dt><dd>' + r[1] + (r[2] ? '<small>' + h(r[2]) + '</small>' : '') + '</dd></div>'; }).join('') + '</dl>'
    + (num('target') && total ? '<p class="hint">' + (gross >= need ? '✓ Meets your ' + usd(num('target')) + '/mi target.' : '✗ Below your ' + usd(num('target')) + '/mi target — ask for ' + usd(need - num('extra')) + ' linehaul (' + usd(need - gross) + ' more).') + '</p>' : '');
});`,
    faq: [
      ['What is a good rate per mile for trucking?', 'It depends on the equipment, lane and season. Compare a load with current market rates for that lane (DAT or Truckstop rate tools) and with your own cost per mile — fuel, truck payment, insurance, maintenance and the driver. A load is only good if the all-in rate per mile, deadhead included, is above your cost per mile.'],
      ['What is the difference between loaded and all-in rate per mile?', 'Loaded RPM divides the pay by the miles with freight on. All-in RPM divides it by every mile the truck drives for the load, including deadhead to the pickup. All-in is the honest number: empty miles cost fuel and time too.'],
      ['How do I calculate deadhead percentage?', 'Deadhead % = empty miles ÷ (loaded + empty miles) × 100. Many carriers try to keep it under 10–15%.'],
      ['How much is fuel per mile for a semi truck?', 'Diesel price divided by MPG. At $3.75 a gallon and 6.5 MPG that is about $0.58 a mile.'],
    ],
    upsell: 'HaulPanel shows the rate per mile of every load on your board, loaded and all-in, and totals it by week, broker and truck — the AI fills the miles from the rate con.',
    partners: ['123lb', 'truckstop', 'dat'],
  },

  '/fuel-cost-calculator': {
    kind: 'tool', name: 'Trucking fuel cost calculator',
    title: 'Trucking Fuel Cost Calculator — Fuel Cost Per Trip and Per Mile',
    description: 'Free fuel cost calculator for semi trucks: gallons and diesel cost for a trip, fuel cost per mile, and how much a better MPG or cheaper fuel saves you a year.',
    h1: 'Trucking fuel cost calculator',
    lead: 'Fuel is the biggest cost per mile after the driver. See what a trip costs in diesel, and what better MPG or a fuel card discount is worth over a year.',
    body: `<div class="tool">
<form class="tool-form" onsubmit="return false">
${group('The trip', field('miles', 'Trip miles (loaded + empty)', '1000', 'number') + field('mpg', 'Truck MPG', '6.5', 'number') + field('price', 'Diesel price, $/gal', '3.75', 'number') + field('reefer', 'Reefer fuel, gal (if any)', '0', 'number'))}
${group('Over a year', field('year', 'Miles per year', '110000', 'number') + field('mpg2', 'With better MPG', '7.2', 'number') + field('disc', 'Fuel card discount, ¢ per gallon', '30', 'number'))}
</form>
<div class="tool-out" id="out" aria-live="polite"></div>
</div>`,
    script: `${BASE_JS}
on(function () {
  var mpg = num('mpg'), price = num('price'), miles = num('miles');
  var gal = (mpg > 0 ? miles / mpg : 0) + num('reefer'), cost = gal * price, perMile = miles ? cost / miles : 0;
  var yGal = mpg > 0 ? num('year') / mpg : 0, yCost = yGal * price;
  var yGal2 = num('mpg2') > 0 ? num('year') / num('mpg2') : yGal, saveMpg = (yGal - yGal2) * price, saveCard = yGal * num('disc') / 100;
  $('#out').innerHTML = '<div class="big-num"><small>Fuel for this trip</small><b>' + usd(cost) + '</b></div><dl class="res">'
    + [['Gallons', Math.round(gal).toLocaleString('en-US') + ' gal', ''], ['Fuel cost per mile', usd(perMile) + ' /mi', 'price ÷ MPG'],
       ['Fuel a year', usd(yCost), Math.round(yGal).toLocaleString('en-US') + ' gal'], ['Saved with ' + num('mpg2') + ' MPG', usd(saveMpg) + ' /yr', ''],
       ['Saved with the fuel card', usd(saveCard) + ' /yr', num('disc') + '¢ off every gallon']]
      .map(function (r) { return '<div><dt>' + h(r[0]) + '</dt><dd>' + r[1] + (r[2] ? '<small>' + h(r[2]) + '</small>' : '') + '</dd></div>'; }).join('') + '</dl>';
});`,
    faq: [
      ['How do I calculate fuel cost for a truck trip?', 'Gallons = miles ÷ MPG. Fuel cost = gallons × diesel price per gallon. A 1,000-mile trip at 6.5 MPG uses about 154 gallons — about $577 at $3.75.'],
      ['What MPG does a semi truck get?', 'Most loaded tractor-trailers get roughly 6 to 8 MPG, depending on the truck, load weight, speed, terrain and idling.'],
      ['Do fuel cards really save money?', 'Fuel cards for trucking (AtoB, Mudflap, TCS, WEX, Comdata and others) give discounts at partner truck stops, often tens of cents a gallon. Over 15,000+ gallons a year that adds up to thousands of dollars.'],
    ],
    upsell: 'HaulPanel keeps loaded and empty miles on every load and shows rate per mile and deadhead by truck, so you see which trucks and lanes make money after fuel.',
    partners: ['coast', 'motive'],
  },

  '/detention-calculator': {
    kind: 'tool', name: 'Detention pay calculator',
    title: 'Detention Pay Calculator for Truckers — Hours Past Free Time',
    description: 'Free detention calculator: enter arrival and departure times, free time and the hourly rate from the rate con — get billable detention hours and the amount to invoice.',
    h1: 'Detention pay calculator',
    lead: 'Waited at the shipper or receiver? Enter the in and out times from the BOL — see how many hours are billable after free time and what to add to the invoice.',
    body: `<div class="tool">
<form class="tool-form" onsubmit="return false">
${group('At the facility', field('in', 'Arrived (check-in)', '2026-11-26T08:00', 'datetime-local') + field('out', 'Left (check-out)', '2026-11-26T13:30', 'datetime-local') + field('appt', 'Appointment time (optional)', '', 'datetime-local'))}
${group('From the rate con', field('free', 'Free time, hours', '2', 'number') + field('rate', 'Detention rate, $ per hour', '50', 'number') + field('round', 'Bill in steps of, minutes', '15', 'number') + field('cap', 'Daily cap, $ (0 = none)', '0', 'number'))}
</form>
<div class="tool-out" id="out" aria-live="polite"></div>
</div>`,
    script: `${BASE_JS}
on(function () {
  var a = Date.parse(val('in')), b = Date.parse(val('out')), ap = Date.parse(val('appt'));
  if (!isFinite(a) || !isFinite(b) || b <= a) { $('#out').innerHTML = '<p class="hint">Enter the arrival and departure times.</p>'; return; }
  // Free time usually counts from the appointment when the truck was early.
  var start = isFinite(ap) && ap > a ? ap : a;
  var mins = Math.max(0, (b - start) / 60000), billMins = Math.max(0, mins - num('free') * 60), step = num('round') > 0 ? num('round') : 1;
  billMins = Math.floor(billMins / step) * step;
  var amount = billMins / 60 * num('rate');
  if (num('cap') > 0) amount = Math.min(amount, num('cap') * Math.ceil(mins / 1440));
  function hm(m) { return Math.floor(m / 60) + ' h ' + Math.round(m % 60) + ' min'; }
  $('#out').innerHTML = '<div class="big-num"><small>Detention to invoice</small><b>' + usd(amount) + '</b></div><dl class="res">'
    + [['Time at the facility', hm((b - a) / 60000), start > a ? 'counted from the appointment: ' + hm(mins) : ''], ['Free time', hm(num('free') * 60), ''],
       ['Billable', hm(billMins), 'in ' + step + '-minute steps'], ['Rate', usd(num('rate')) + ' /h', '']]
      .map(function (r) { return '<div><dt>' + h(r[0]) + '</dt><dd>' + r[1] + (r[2] ? '<small>' + h(r[2]) + '</small>' : '') + '</dd></div>'; }).join('') + '</dl>'
    + '<p class="hint">Tell the broker while you are still waiting, and keep the in/out times signed on the BOL — most brokers pay detention only with proof and notice.</p>';
});`,
    faq: [
      ['How is truck detention calculated?', 'Detention = (time at the facility − free time) × hourly rate. With 2 hours free and $50 an hour, a 5½-hour wait pays 3½ hours = $175. Use the free time and rate written on your rate confirmation.'],
      ['How much free time do shippers usually give?', 'Two hours at each pickup and delivery is the most common, but the rate con decides — some give one, some three.'],
      ['How do I get paid for detention?', 'Tell the broker as soon as free time is running out, get in and out times signed on the BOL (or from the ELD), and add the detention to your invoice with that proof.'],
    ],
    upsell: 'In HaulPanel detention, layover, TONU and lumper live on the load and go on the invoice automatically, with the signed BOL attached as proof.',
    partners: ['motive', 'otr'],
  },

  '/freight-invoice-template': {
    kind: 'tool', name: 'Freight invoice template',
    title: 'Free Freight Invoice Template for Trucking — Fill In and Download PDF',
    description: 'Free trucking invoice template for carriers and dispatchers: fill in the broker, load number, lane, linehaul and accessorials, and download a clean PDF invoice. No sign-up.',
    h1: 'Freight invoice template',
    lead: 'Fill in the load and download a clean PDF invoice for the broker — linehaul, detention, lumper and other charges, payment terms and remit-to.',
    body: `<div class="tool doc-tool">
<form class="tool-form" onsubmit="return false">
${group('Your company', field('co', 'Company name', 'Your Trucking LLC') + field('mc', 'MC number', 'MC-123456') + area('coaddr', 'Address', '100 Main St\nDallas, TX 75201') + field('cophone', 'Phone', '(214) 555-0100') + field('coemail', 'Email', 'billing@yourtrucking.com'))}
${group('Bill to', field('bill', 'Broker / customer', 'ABC Logistics') + area('billaddr', 'Address or billing email', 'ap@abclogistics.com'))}
${group('Invoice', field('num', 'Invoice #', '1001') + field('date', 'Invoice date', '', 'date') + field('terms', 'Terms', 'Net 30') + field('load', 'Load / PRO #', 'ABC-778812'))}
${group('The load', field('from', 'Pickup (City, ST)', 'Dallas, TX') + field('pdate', 'Pickup date', '', 'date') + field('to', 'Delivery (City, ST)', 'Atlanta, GA') + field('ddate', 'Delivery date', '', 'date'))}
${group('Charges', field('line', 'Linehaul, $', '2400', 'number') + field('fsc', 'Fuel surcharge, $', '0', 'number') + field('det', 'Detention, $', '0', 'number') + field('lump', 'Lumper (reimbursed), $', '0', 'number') + field('oth', 'Other, $', '0', 'number') + field('othname', 'Other — what for', ''))}
${group('Payment', area('remit', 'Remit to (bank, factoring company, or check address)', 'Pay by ACH to Your Trucking LLC.\nQuestions: billing@yourtrucking.com') + area('notes', 'Notes', 'Signed BOL/POD and rate confirmation attached.'))}
</form>
<div class="tool-out">${docTools}<article class="doc" id="doc"></article></div>
</div>`,
    script: `${BASE_JS}
var today = new Date().toISOString().slice(0, 10);
document.querySelectorAll('input[type=date]').forEach(function (el) { if (!el.value) el.value = today; });
function d(k) { var v = val(k); if (!v) return ''; var p = v.split('-'); return p[1] + '/' + p[2] + '/' + p[0]; }
on(function () {
  var items = [['Linehaul', num('line')], ['Fuel surcharge', num('fsc')], ['Detention', num('det')], ['Lumper (reimbursement)', num('lump')], [val('othname') || 'Other', num('oth')]]
    .filter(function (x) { return x[1]; });
  var total = items.reduce(function (s, x) { return s + x[1]; }, 0);
  $('#doc').innerHTML = '<header class="doc-h"><div><h2>' + h(val('co')) + '</h2><p>' + h(val('mc')) + '<br>' + br(val('coaddr')) + '<br>' + h(val('cophone')) + ' · ' + h(val('coemail')) + '</p></div>'
    + '<div class="doc-t"><h1>INVOICE</h1><p><b>#' + h(val('num')) + '</b><br>Date: ' + d('date') + '<br>Terms: ' + h(val('terms')) + '</p></div></header>'
    + '<div class="doc-2"><div><small>BILL TO</small><p><b>' + h(val('bill')) + '</b><br>' + br(val('billaddr')) + '</p></div>'
    + '<div><small>LOAD</small><p>Load #: <b>' + h(val('load')) + '</b><br>Pickup: ' + h(val('from')) + ' — ' + d('pdate') + '<br>Delivery: ' + h(val('to')) + ' — ' + d('ddate') + '</p></div></div>'
    + '<table class="doc-tb"><thead><tr><th>Description</th><th>Amount</th></tr></thead><tbody>'
    + items.map(function (x) { return '<tr><td>' + h(x[0]) + '</td><td>' + usd(x[1]) + '</td></tr>'; }).join('')
    + '</tbody><tfoot><tr><td>Total due</td><td>' + usd(total) + '</td></tr></tfoot></table>'
    + '<div class="doc-2"><div><small>REMIT TO</small><p>' + br(val('remit')) + '</p></div><div><small>NOTES</small><p>' + br(val('notes')) + '</p></div></div>';
});`,
    faq: [
      ['What should a trucking invoice include?', 'Your company name, MC number and contact; the broker’s name and billing address or email; invoice number and date; the broker’s load number; pickup and delivery cities and dates; linehaul and every accessorial (detention, lumper, TONU, layover) as separate lines; the total; payment terms; and where to pay. Attach the rate confirmation and the signed BOL/POD.'],
      ['What documents go with a freight invoice?', 'Most brokers pay only with the rate confirmation and the signed bill of lading or proof of delivery. Add lumper and scale receipts for those charges.'],
      ['When do brokers pay a freight invoice?', 'Standard terms are usually 30 days (Net 30), sometimes 15–45. Quick pay or factoring gets you paid in a day or two for a fee.'],
      ['What if I use a factoring company?', 'Put the factoring company in “Remit to” exactly as your notice of assignment says, or send the invoice to the factor and let them bill the broker.'],
    ],
    upsell: 'HaulPanel makes the invoice from the load itself and emails it to the broker in one click with the rate con, BOL and POD in one PDF — or sends the packet to your factoring company.',
    partners: ['otr', 'ecapital', 'quickbooks'],
  },

  '/rate-confirmation-template': {
    kind: 'tool', name: 'Rate confirmation template',
    title: 'Free Rate Confirmation Template for Freight Brokers — PDF',
    description: 'Free rate confirmation template for freight brokers and dispatchers: broker and carrier details, pickup and delivery, equipment, rate and accessorials, terms and signatures. Fill in and download a PDF.',
    h1: 'Rate confirmation template',
    lead: 'Fill in the load and get a clean rate confirmation to send to the carrier: who, what, where, when, how much — and the terms both sides sign.',
    body: `<div class="tool doc-tool">
<form class="tool-form" onsubmit="return false">
${group('Broker', field('bro', 'Brokerage', 'Your Brokerage LLC') + field('bmc', 'Broker MC', 'MC-654321') + field('bcontact', 'Contact, phone, email', 'Jane Doe · (312) 555-0100 · ops@yourbrokerage.com') + field('load', 'Load #', 'YB-10452'))}
${group('Carrier', field('car', 'Carrier', 'Fast Lane Trucking LLC') + field('cmc', 'Carrier MC / USDOT', 'MC-123456 / 3456789') + field('driver', 'Driver, phone, truck #', 'Mike · (555) 010-2000 · #101') + field('equip', 'Equipment', "53' Dry Van"))}
${group('Pickup', area('pu', 'Shipper and address', 'Acme Foods\n1200 Industrial Rd, Dallas, TX 75212') + field('pudt', 'Date and time', '', 'datetime-local') + field('puref', 'PU #', ''))}
${group('Delivery', area('del', 'Receiver and address', 'Southeast DC\n55 Logistics Pkwy, Atlanta, GA 30336') + field('deldt', 'Date and time', '', 'datetime-local') + field('delref', 'Delivery / PO #', ''))}
${group('Freight', field('com', 'Commodity', 'Packaged food') + field('wt', 'Weight, lbs', '42000') + field('pcs', 'Pieces / pallets', '24 pallets') + field('temp', 'Temperature (reefer)', ''))}
${group('Pay', field('rate', 'Linehaul, $', '2100', 'number') + field('acc', 'Accessorials agreed, $', '0', 'number') + field('accn', 'Accessorials — what', '') + field('pay', 'Payment terms', 'Net 30 from receipt of invoice and signed POD; quick pay 2%'))}
${group('Terms', area('terms', 'Terms and conditions', 'Carrier must not re-broker, co-broker, or assign this load. Detention $50/h after 2 hours free with notice to broker. Tracking updates required. Signed BOL/POD required for payment.'))}
</form>
<div class="tool-out">${docTools}<article class="doc" id="doc"></article></div>
</div>`,
    script: `${BASE_JS}
function dt(k) { var v = val(k); if (!v) return 'TBD'; var x = new Date(v); return x.toLocaleString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
on(function () {
  var total = num('rate') + num('acc');
  $('#doc').innerHTML = '<header class="doc-h"><div><h2>' + h(val('bro')) + '</h2><p>' + h(val('bmc')) + '<br>' + h(val('bcontact')) + '</p></div><div class="doc-t"><h1>RATE CONFIRMATION</h1><p>Load #: <b>' + h(val('load')) + '</b></p></div></header>'
    + '<div class="doc-2"><div><small>CARRIER</small><p><b>' + h(val('car')) + '</b><br>' + h(val('cmc')) + '<br>' + h(val('driver')) + '</p></div><div><small>EQUIPMENT & FREIGHT</small><p>' + h(val('equip')) + '<br>' + h(val('com')) + (val('wt') ? ' · ' + h(val('wt')) + ' lbs' : '') + (val('pcs') ? ' · ' + h(val('pcs')) : '') + (val('temp') ? '<br>Temp: ' + h(val('temp')) : '') + '</p></div></div>'
    + '<div class="doc-2"><div><small>PICKUP</small><p>' + br(val('pu')) + '<br><b>' + dt('pudt') + '</b>' + (val('puref') ? '<br>PU #: ' + h(val('puref')) : '') + '</p></div><div><small>DELIVERY</small><p>' + br(val('del')) + '<br><b>' + dt('deldt') + '</b>' + (val('delref') ? '<br>Ref #: ' + h(val('delref')) : '') + '</p></div></div>'
    + '<table class="doc-tb"><thead><tr><th>Pay to carrier</th><th>Amount</th></tr></thead><tbody><tr><td>Linehaul (all-in unless listed below)</td><td>' + usd(num('rate')) + '</td></tr>'
    + (num('acc') ? '<tr><td>' + h(val('accn') || 'Accessorials') + '</td><td>' + usd(num('acc')) + '</td></tr>' : '')
    + '</tbody><tfoot><tr><td>Total</td><td>' + usd(total) + '</td></tr></tfoot></table>'
    + '<p><small>PAYMENT</small><br>' + h(val('pay')) + '</p><p><small>TERMS</small><br>' + br(val('terms')) + '</p>'
    + '<div class="doc-2 sign"><div>Broker signature / date<span></span></div><div>Carrier signature / date<span></span></div></div>';
});`,
    faq: [
      ['What is a rate confirmation in trucking?', 'A rate confirmation (rate con) is the agreement between a broker and a carrier for one load: the pickup and delivery, dates and times, equipment, the rate and accessorials, and the terms. Both sides sign it before the truck is dispatched, and the carrier needs it to get paid.'],
      ['What must a rate confirmation include?', 'Broker and carrier names with MC numbers, the load number, shipper and receiver addresses, pickup and delivery dates and times, commodity, weight and equipment, the rate and any agreed accessorials, payment terms, and the terms both sides accept (no re-brokering, detention, tracking, documents for payment).'],
      ['Who sends the rate confirmation?', 'The broker sends it to the carrier (or to the carrier’s dispatcher). The carrier signs and sends it back before pickup.'],
    ],
    upsell: 'In HaulPanel’s broker mode the rate confirmation is made from the load and emailed to the carrier in one click; for dispatchers the AI reads incoming rate cons into loads.',
    partners: ['truckstop', 'dat'],
  },

  '/dispatch-agreement-template': {
    kind: 'tool', name: 'Dispatcher–carrier agreement',
    title: 'Truck Dispatcher Carrier Agreement Template — Free, Fill In & Print',
    description: 'Free truck dispatch service agreement template between a dispatcher and a motor carrier: services, dispatch fee, payment, authority, no-forced-dispatch, termination. Fill in and download a PDF.',
    h1: 'Dispatcher–carrier agreement template',
    lead: 'The agreement a dispatch service signs with each carrier it works for: what you do, your fee, when you get paid, and who is responsible for what.',
    body: `<div class="tool doc-tool">
<form class="tool-form" onsubmit="return false">
${group('Dispatcher', field('dis', 'Dispatch company', 'Your Dispatch LLC') + field('disaddr', 'Address', '100 Main St, Dallas, TX 75201') + field('disname', 'Signer name and title', 'Alex Carter, Owner'))}
${group('Carrier', field('car', 'Carrier', 'Fast Lane Trucking LLC') + field('cmc', 'MC / USDOT', 'MC-123456 / USDOT 3456789') + field('caraddr', 'Address', '200 Oak St, Houston, TX 77002') + field('carname', 'Signer name and title', 'Mike Brown, Owner'))}
${group('Terms', field('fee', 'Dispatch fee, % of gross', '8', 'number') + field('flat', 'Or flat fee per week, $ (0 = use %)', '0', 'number') + field('payday', 'Fee paid', 'weekly, every Friday, for loads delivered the week before') + field('notice', 'Notice to end the agreement, days', '7', 'number') + field('start', 'Start date', '', 'date') + field('law', 'Governing state', 'Texas'))}
</form>
<div class="tool-out">${docTools}<article class="doc" id="doc"></article></div>
</div>`,
    script: `${BASE_JS}
var today = new Date().toISOString().slice(0, 10);
document.querySelectorAll('input[type=date]').forEach(function (el) { if (!el.value) el.value = today; });
on(function () {
  var fee = num('flat') > 0 ? 'a flat fee of ' + usd(num('flat')) + ' per week' : num('fee') + '% of the gross amount paid for each load the Dispatcher arranges (linehaul and accessorials; lumper reimbursements excluded)';
  var s = val('start').split('-'), start = s.length === 3 ? s[1] + '/' + s[2] + '/' + s[0] : '';
  var cl = [
    ['Parties', 'This Dispatch Service Agreement is made on ' + start + ' between <b>' + h(val('dis')) + '</b>, ' + h(val('disaddr')) + ' (the “Dispatcher”), and <b>' + h(val('car')) + '</b>, ' + h(val('cmc')) + ', ' + h(val('caraddr')) + ' (the “Carrier”).'],
    ['Services', 'The Dispatcher acts as the Carrier’s agent to find loads from freight brokers and shippers, negotiate rates, handle rate confirmations and paperwork, communicate with brokers during transit, and prepare invoices on the Carrier’s behalf. The Dispatcher does not take possession of freight and does not act as a broker or a motor carrier.'],
    ['Carrier’s authority and choice', 'All loads move under the Carrier’s own operating authority, insurance and responsibility. The Carrier may accept or refuse any load (no forced dispatch). The Carrier is responsible for its drivers, equipment, hours of service, safety and compliance with FMCSA and state rules.'],
    ['Fee', 'The Carrier pays the Dispatcher ' + fee + ', ' + h(val('payday')) + '. The fee is earned when a load arranged by the Dispatcher is delivered. Freight charges are paid by brokers to the Carrier (or its factoring company), not to the Dispatcher, unless the Carrier agrees otherwise in writing.'],
    ['Documents and limited authority', 'The Carrier authorizes the Dispatcher to sign rate confirmations and carrier setup packets on its behalf for loads the Carrier accepts. The Carrier will provide its operating authority, certificate of insurance, W-9 and, if used, its factoring notice of assignment.'],
    ['Independence', 'The Dispatcher and the Carrier are independent businesses. Nothing here makes either an employee, partner or joint venturer of the other. The Dispatcher may work for other carriers.'],
    ['Liability', 'The Dispatcher is not liable for cargo loss or damage, accidents, fines, or a broker’s failure to pay. The Carrier is not liable for the Dispatcher’s own business costs.'],
    ['Confidentiality and non-solicitation', 'Each side keeps the other’s rates, customers and business information confidential, during this agreement and for one year after it ends.'],
    ['Term and termination', 'This agreement starts on the date above and continues until either side ends it with ' + num('notice') + ' days’ written notice. Fees for loads delivered before the end remain due.'],
    ['Governing law', 'This agreement is governed by the laws of the State of ' + h(val('law')) + '.'],
  ];
  $('#doc').innerHTML = '<h1 class="doc-c">DISPATCH SERVICE AGREEMENT</h1><ol class="doc-cl">' + cl.map(function (c) { return '<li><b>' + c[0] + '.</b> ' + c[1] + '</li>'; }).join('') + '</ol>'
    + '<div class="doc-2 sign"><div>Dispatcher: ' + h(val('disname')) + '<span></span>Signature / date</div><div>Carrier: ' + h(val('carname')) + '<span></span>Signature / date</div></div>';
});`,
    faq: [
      ['Do truck dispatchers need a contract with carriers?', 'Yes — a written dispatch agreement with every carrier is the norm. It defines the fee, what the dispatcher may sign, and that loads move under the carrier’s own authority. Brokers often ask for it before they talk to a dispatcher.'],
      ['How much do truck dispatchers charge?', 'Most charge 5–10% of the load’s gross pay; some charge a flat weekly fee per truck. The agreement should say which, and when it is paid.'],
      ['Is this template legal advice?', 'No. It is a plain starting point. Rules differ by state and by how you work (for example, whether you ever take payment from shippers), so have a transportation attorney review your final agreement.'],
    ],
    upsell: 'HaulPanel keeps each carrier’s dispatch fee (percent or weekly), and makes weekly carrier statements with the fee calculated on every delivered load.',
    partners: ['zenbusiness', 'northwest', 'nextins'],
  },

  '/carrier-packet-template': {
    kind: 'tool', name: 'Carrier packet template',
    title: 'Carrier Packet Template — Carrier Setup Form for Brokers & Dispatchers',
    description: 'Free carrier packet / carrier setup form: company, MC and USDOT, contacts, insurance, factoring and payment details, equipment and lanes, plus the documents to attach. Fill in and download a PDF.',
    h1: 'Carrier packet template',
    lead: 'The carrier setup form brokers ask for before the first load — fill it once, save the PDF, and send it with your authority, insurance certificate and W-9.',
    body: `<div class="tool doc-tool">
<form class="tool-form" onsubmit="return false">
${group('Company', field('car', 'Legal name', 'Fast Lane Trucking LLC') + field('dba', 'DBA (if any)', '') + field('mc', 'MC #', '123456') + field('dot', 'USDOT #', '3456789') + field('ein', 'EIN (from your W-9)', '') + area('addr', 'Physical address', '200 Oak St, Houston, TX 77002'))}
${group('Contacts', field('owner', 'Owner / contact', 'Mike Brown') + field('phone', 'Phone', '(713) 555-0100') + field('email', 'Email', 'dispatch@fastlane.com') + field('disp', 'Dispatcher (if any)', 'Your Dispatch LLC · (214) 555-0100'))}
${group('Insurance', field('ins', 'Insurance company / agent', '') + field('auto', 'Auto liability limit', '$1,000,000') + field('cargo', 'Cargo limit', '$100,000') + field('exp', 'Policy expires', '', 'date'))}
${group('Payment', field('fact', 'Factoring company (if any)', '') + area('pay', 'Pay to (bank / factoring remit / quick pay)', 'ACH — bank details on request by phone'))}
${group('Equipment & lanes', field('trucks', 'Trucks', '3') + field('equip', 'Equipment', "53' Dry Van, Reefer") + area('lanes', 'Preferred lanes / states', 'TX ↔ GA, TN, FL'))}
</form>
<div class="tool-out">${docTools}<article class="doc" id="doc"></article></div>
</div>`,
    script: `${BASE_JS}
on(function () {
  function row(a, b) { return '<tr><th>' + a + '</th><td>' + (b || '&nbsp;') + '</td></tr>'; }
  var e = val('exp').split('-'), exp = e.length === 3 ? e[1] + '/' + e[2] + '/' + e[0] : '';
  $('#doc').innerHTML = '<h1 class="doc-c">CARRIER PROFILE</h1><table class="doc-kv">'
    + row('Legal name', h(val('car'))) + row('DBA', h(val('dba'))) + row('MC # / USDOT #', h(val('mc')) + ' / ' + h(val('dot'))) + row('EIN', h(val('ein'))) + row('Address', br(val('addr')))
    + row('Owner / contact', h(val('owner'))) + row('Phone / email', h(val('phone')) + ' · ' + h(val('email'))) + row('Dispatcher', h(val('disp')))
    + row('Insurance', h(val('ins'))) + row('Auto liability / cargo', h(val('auto')) + ' / ' + h(val('cargo'))) + row('Policy expires', exp)
    + row('Factoring', h(val('fact'))) + row('Pay to', br(val('pay'))) + row('Trucks / equipment', h(val('trucks')) + ' · ' + h(val('equip'))) + row('Lanes', br(val('lanes')))
    + '</table><p><small>ATTACHED</small><br>☐ MC operating authority letter &nbsp; ☐ Certificate of insurance (broker as certificate holder) &nbsp; ☐ W-9 &nbsp; ☐ Factoring notice of assignment (if factoring) &nbsp; ☐ Signed broker–carrier agreement</p>'
    + '<div class="doc-2 sign"><div>Signed for the carrier<span></span>Name / title / date</div><div></div></div>';
});`,
    faq: [
      ['What is in a carrier packet?', 'A carrier setup form (company, MC and USDOT, contacts, payment details), the MC operating authority letter, a certificate of insurance naming the broker as certificate holder, a W-9, the factoring notice of assignment if you factor, and the broker–carrier agreement signed.'],
      ['Why do brokers ask for a carrier packet?', 'To verify the carrier is real and authorized, has insurance in force, and to know where to send payment — and to protect both sides from fraud and double brokering.'],
      ['How do brokers check a carrier?', 'They look up the MC and USDOT in FMCSA records (authority status and age, insurance on file, safety), compare the phone and email with FMCSA, and often use a monitoring service. HaulPanel’s free MC lookup does those checks.'],
    ],
    upsell: 'HaulPanel keeps every carrier’s MC, insurance and factoring details, checks them in FMCSA when you add them, and warns you if their authority or insurance changes.',
    partners: ['nextins', 'otr'],
  },

  '/how-to-become-a-truck-dispatcher': {
    kind: 'guide', name: 'How to become a truck dispatcher',
    title: 'How to Become a Truck Dispatcher in 2026 — Step-by-Step Guide',
    description: 'How to start as an independent truck dispatcher: what the job is, whether you need broker authority, setting up the business, the carrier agreement, finding your first carriers, what to charge and the tools you need.',
    h1: 'How to become a truck dispatcher',
    lead: 'A plain, step-by-step guide to starting an independent truck dispatch service — from what the job really is to signing your first carriers.',
    body: `<article class="guide">
<h2>What a truck dispatcher does</h2>
<p>An independent dispatcher works for carriers — usually owner-operators and small fleets — as their agent. You find loads on load boards and from brokers, negotiate the rate, handle the rate confirmation and the carrier packet, keep the broker updated while the truck is moving, and make sure the paperwork (BOL, POD, invoice) gets the carrier paid. You get a fee, most often a percent of each load’s gross.</p>
<h2>Do you need a license or broker authority?</h2>
<p>There is no federal license for dispatchers. But the line between dispatching and brokering matters. In 2023 FMCSA published guidance on who is a broker: a dispatcher who works only as the carrier’s agent under a written agreement, and is paid by the carrier, generally is not a broker. If you arrange transportation for shippers, take payment from shippers or brokers for arranging loads, or control the carrier’s choices, you may need broker authority (an MC with a $75,000 BMC-84 or BMC-85 bond). If in doubt, ask a transportation attorney before you start.</p>
<h2>Step by step</h2>
<ol class="guide-steps">
<li><b>Learn the basics.</b> Equipment types (dry van, reefer, flatbed, power only), how load boards work, rate per mile and deadhead, hours of service, what a rate con, BOL and POD are, and how brokers pay (Net 30, quick pay, factoring). The <a href="/rate-per-mile-calculator">rate per mile calculator</a> is a good place to practice.</li>
<li><b>Set up the business.</b> Form an LLC in your state, get an EIN from the IRS (free, online), open a business bank account, and consider general liability or errors-and-omissions insurance.</li>
<li><b>Prepare your paperwork.</b> A <a href="/dispatch-agreement-template">dispatcher–carrier agreement</a> for each carrier, a limited authorization to sign rate cons for them, and a simple way to send invoices — try the <a href="/freight-invoice-template">freight invoice template</a>.</li>
<li><b>Choose your niche.</b> Start with one equipment type and a few regions you learn well — rates, seasons and the brokers that run those lanes.</li>
<li><b>Find your first carriers.</b> New authorities are the easiest to reach: carriers that just got their MC need loads and rarely have a dispatcher yet. <a href="/new-mc-leads">New MC leads</a> lists 150+ of them every day with phone and email. Facebook and Telegram trucking groups and referrals work too.</li>
<li><b>Set your fee.</b> Most dispatchers charge 5–10% of gross per load; some charge a flat weekly fee per truck. Write it in the agreement, with when it is paid.</li>
<li><b>Get the tools.</b> A load board account (DAT, Truckstop, 123Loadboard — many dispatchers work in the carrier’s account), a phone line, email, a <a href="/mc-number-lookup">broker check tool</a> and a TMS to track loads, invoices and your fees.</li>
<li><b>Book, track, invoice, repeat.</b> Check every broker before booking, confirm the rate con matches what you agreed, update the broker, collect the signed POD, and invoice the same day.</li>
</ol>
<h2>How much do truck dispatchers make?</h2>
<p>A dispatcher earns their fee on what their carriers gross. At 8% on a truck that grosses $8,000 a week, that is $640 a week per truck — so income grows with the number of trucks you keep busy and happy.</p>
</article>`,
    faq: [
      ['Do I need a license to be a truck dispatcher?', 'There is no federal dispatcher license. If you act only as the carrier’s agent under a written agreement and are paid by the carrier, you generally don’t need broker authority; if you arrange freight for shippers or are paid by them, you may. Check FMCSA’s broker guidance or ask a transportation attorney.'],
      ['How do truck dispatchers find carriers?', 'Most start with new authorities — carriers that just got their MC number — plus referrals, Facebook and Telegram trucking groups. New MC leads with phone and email are published daily.'],
      ['What percentage do truck dispatchers take?', 'Usually 5–10% of each load’s gross pay. Some charge a flat weekly fee per truck.'],
      ['Can I dispatch trucks from home?', 'Yes. Most independent dispatchers work remotely with a computer, a phone, load board access and a TMS.'],
    ],
    upsell: 'HaulPanel is a free TMS built for dispatch services: every load from booking to payment, each carrier’s fee, weekly carrier statements, and an AI assistant that turns rate cons into loads.',
    partners: ['zenbusiness', 'northwest', '123lb', 'bobtail', 'quickbooks'],
  },

  '/how-to-check-a-freight-broker': {
    kind: 'guide', name: 'How to check a freight broker',
    title: 'How to Check a Freight Broker Before Booking a Load — 7 Checks',
    description: 'How carriers and dispatchers can vet a freight broker before booking: active broker authority, the $75,000 bond, authority age, matching contact details, credit and days to pay, and the fraud signs to watch for.',
    h1: 'How to check a freight broker before you book',
    lead: 'Double brokering and fake brokers cost carriers loads they never get paid for. These seven checks take two minutes and catch most of it.',
    body: `<article class="guide">
<ol class="guide-steps">
<li><b>Active broker authority.</b> Look up the broker’s MC number: the broker authority must be active (not pending, revoked or inactive). Use <a href="/mc-number-lookup">HaulPanel’s free MC lookup</a> or FMCSA’s own records.</li>
<li><b>The $75,000 bond or trust is on file.</b> Every broker must keep a BMC-84 surety bond or BMC-85 trust fund of $75,000. If it is cancelled or pending cancellation, don’t haul for them.</li>
<li><b>How long they have had authority.</b> Brand-new authorities aren’t bad by themselves, but combined with other red flags they are a reason to slow down.</li>
<li><b>The contact details match FMCSA.</b> Call the phone number on file with FMCSA — not the one in the email — and confirm the person and the load. Check that the email domain belongs to the company. Fraudsters copy real brokers’ names and MC numbers with look-alike emails.</li>
<li><b>Other companies on the same phone or email.</b> One phone or email shared by many MC numbers is a classic fraud sign. HaulPanel’s lookup shows those matches.</li>
<li><b>Credit and days to pay.</b> Load board credit scores and days-to-pay (DAT, Truckstop) and your factoring company’s credit check tell you if they actually pay, and how fast.</li>
<li><b>The rate con matches the deal.</b> Same broker name and MC as you checked, the rate and accessorials you agreed, real addresses. A rate con from a different company than the one you talked to is a stop sign.</li>
</ol>
<h2>Red flags of double brokering</h2>
<ul>
<li>The broker asks you to send BOLs to a different email or to use a different company name at pickup.</li>
<li>Rates well above market on an easy lane, and pressure to decide right now.</li>
<li>Free-mail addresses (gmail, outlook) or domains one letter off from a known broker.</li>
<li>They can’t be reached at the FMCSA phone number.</li>
</ul>
</article>`,
    faq: [
      ['How do I verify a freight broker’s MC number?', 'Search the MC number in FMCSA records (or HaulPanel’s free MC lookup): check that broker authority is active, the $75,000 bond is on file, and the name and address match what the broker told you.'],
      ['What is a BMC-84 bond?', 'A $75,000 surety bond every freight broker must keep on file with FMCSA (a BMC-85 is the trust-fund version). It is there so carriers and shippers can claim if a broker doesn’t pay.'],
      ['How can I tell if a load is double brokered?', 'Watch for a rate con from a different company than the one you booked with, instructions to use another name at pickup, look-alike emails, and contact details that don’t match FMCSA. Call the broker at the phone number FMCSA has on file.'],
    ],
    upsell: 'HaulPanel checks every broker and carrier on your board in FMCSA — authority, bond and insurance, authority age and shared phone/email — and warns you when something changes.',
    partners: ['truckstop', '123lb', 'otr'],
  },

  '/factoring-vs-quick-pay': {
    kind: 'guide', name: 'Factoring vs quick pay',
    title: 'Freight Factoring vs Quick Pay — Which Is Better for Carriers?',
    description: 'Freight factoring vs broker quick pay compared: how each works, typical fees, contracts, recourse, credit checks, fuel advances — and when each one makes sense for owner-operators and small fleets.',
    h1: 'Freight factoring vs quick pay',
    lead: 'Both get you paid in days instead of 30+. They work differently, cost differently, and fit different carriers.',
    body: `<article class="guide">
<h2>How they work</h2>
<p><b>Quick pay</b> is offered by the broker: you ask to be paid early on a load and the broker pays in one to a few days, minus a fee — often 1–5% of the load. It is per load, with no contract.</p>
<p><b>Factoring</b> is a separate company that buys your invoices. You send it the invoice and documents; it advances most of the amount (often 90–97%) within a day, collects from the broker, and keeps a fee. Brokers get a notice of assignment telling them to pay the factor.</p>
<table class="cmp"><thead><tr><th></th><th>Quick pay</th><th>Factoring</th></tr></thead><tbody>
<tr><th>Who pays you</th><td>The broker, early</td><td>The factoring company, then it collects</td></tr>
<tr><th>Typical cost</th><td>About 1–5% per load</td><td>About 1–5% per invoice, sometimes plus fees</td></tr>
<tr><th>Contract</th><td>None, load by load</td><td>Usually a contract; check the term, minimums and how to leave</td></tr>
<tr><th>Works with</th><td>Only brokers that offer it</td><td>Almost every broker</td></tr>
<tr><th>Broker credit checks</th><td>No</td><td>Yes — the factor checks brokers before you book</td></tr>
<tr><th>If the broker doesn’t pay</th><td>You weren’t paid early, but you still bill normally</td><td>Recourse: you pay it back. Non-recourse: the factor takes the risk (for credit failure, read the terms)</td></tr>
<tr><th>Extras</th><td>—</td><td>Fuel advances, fuel card discounts, collections</td></tr>
</tbody></table>
<h2>Which one fits you</h2>
<ul>
<li><b>Quick pay</b> fits carriers with enough cash to wait on most loads, who only want some loads paid early, and who mostly work with a few brokers that offer it.</li>
<li><b>Factoring</b> fits new authorities and small fleets that need cash every week for fuel and payroll, work with many brokers, and value credit checks and collections.</li>
</ul>
<h2>Before you sign with a factor</h2>
<p>Read the contract term and the cancellation steps, any monthly minimums, extra fees (ACH, wire, invoice processing, no-buy), whether it is recourse or non-recourse and what non-recourse really covers, and how fast they pay. Keep your invoices clean — rate con, signed BOL/POD and receipts — and factoring goes faster.</p>
</article>`,
    faq: [
      ['Is factoring better than quick pay?', 'Neither is always better. Quick pay is simpler and contract-free but only works with brokers that offer it. Factoring works with almost all brokers and adds credit checks and fuel advances, but usually comes with a contract.'],
      ['How much does freight factoring cost?', 'Often about 1–5% of each invoice, depending on volume, recourse or non-recourse, and the brokers’ credit. Ask about every extra fee before signing.'],
      ['What is a notice of assignment?', 'A letter from your factoring company to each broker telling them to pay the factor instead of you for your invoices.'],
      ['Can I use quick pay if I factor?', 'Usually not on factored loads — those invoices belong to the factor. Some contracts let you choose which loads to factor; read yours.'],
    ],
    upsell: 'HaulPanel sends the invoice packet straight to your factoring company — invoice, rate con, BOL and POD in one PDF — or the invoice to the broker for quick pay.',
    partners: ['otr', 'ecapital', 'bobtail'],
  },
};

export const FREE_LINKS: [string, string][] = Object.entries(FREE).map(([p, f]) => [p, f.name]);

const FREE_CSS = `<style>
.tool{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:28px;align-items:start;margin:24px 0 48px}
.doc-tool{grid-template-columns:minmax(0,420px) minmax(0,1fr)}
fieldset{border:1px solid var(--line);border-radius:14px;padding:14px 16px 6px;margin:0 0 14px}legend{font-weight:700;font-size:14px;padding:0 6px}
.fgrid{display:grid;grid-template-columns:1fr 1fr;gap:10px 12px}.doc-tool .fgrid{grid-template-columns:1fr}
.fld{display:flex;flex-direction:column;gap:4px;font-size:13px;color:var(--muted);margin-bottom:8px}.fld.wide{grid-column:1/-1}
.fld input,.fld textarea{font:inherit;font-size:15px;color:var(--text);border:1px solid var(--line);border-radius:9px;padding:9px 11px;background:var(--bg);width:100%}
.fld input:focus,.fld textarea:focus{outline:2px solid var(--accent-soft);border-color:var(--accent)}
.tool-out{position:sticky;top:80px}
.big-num{background:var(--accent-soft);border-radius:14px;padding:18px 20px;margin-bottom:14px}.big-num small{display:block;color:var(--muted);font-weight:600}.big-num b{font-size:38px;letter-spacing:-.02em}
.res{margin:0;border:1px solid var(--line);border-radius:14px;overflow:hidden}.res div{display:flex;justify-content:space-between;gap:12px;padding:11px 16px;border-bottom:1px solid var(--line)}.res div:last-child{border-bottom:0}
.res dt{color:var(--muted)}.res dd{margin:0;font-weight:700;text-align:right}.res dd small{display:block;font-weight:400;color:var(--muted);font-size:12.5px}
.hint{margin-top:12px;padding:12px 14px;border-radius:12px;background:var(--soft);font-size:14.5px}
.doc-actions{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:12px}.doc-actions .note{margin:0}
.doc{border:1px solid var(--line);border-radius:12px;padding:32px;background:#fff;color:#111;font-size:13.5px;line-height:1.5;box-shadow:0 12px 30px rgba(15,23,42,.08)}
.doc h1{font-size:22px;margin:0 0 6px;letter-spacing:.02em}.doc h2{font-size:18px;margin:0 0 4px}.doc small{color:#666;font-weight:700;font-size:11px;letter-spacing:.06em}
.doc-h{display:flex;justify-content:space-between;gap:20px;border-bottom:2px solid #111;padding-bottom:14px;margin-bottom:16px}.doc-t{text-align:right}
.doc-2{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin:0 0 14px}
.doc-tb,.doc-kv{width:100%;border-collapse:collapse;margin:8px 0 16px}.doc-tb th,.doc-tb td{border-bottom:1px solid #ddd;padding:8px 6px;text-align:left}.doc-tb td:last-child,.doc-tb th:last-child{text-align:right}
.doc-tb tfoot td{font-weight:800;font-size:15px;border-top:2px solid #111;border-bottom:0}
.doc-kv th{width:38%;text-align:left;color:#555;font-weight:600;padding:7px 6px;border-bottom:1px solid #eee;vertical-align:top}.doc-kv td{padding:7px 6px;border-bottom:1px solid #eee}
.doc-c{text-align:center}.doc-cl{padding-left:20px}.doc-cl li{margin:0 0 9px}
.sign{margin-top:32px}.sign div span{display:block;border-bottom:1px solid #111;height:36px;margin:6px 0 4px}
.guide{max-width:760px;margin:12px 0 40px}.guide h2{margin-top:32px}.guide-steps{padding-left:22px}.guide-steps li{margin:0 0 14px}.guide ul li{margin:0 0 6px}
.cmp{width:100%;border-collapse:collapse;margin:16px 0 8px;font-size:15px}.cmp th,.cmp td{border:1px solid var(--line);padding:10px 12px;text-align:left;vertical-align:top}.cmp thead th{background:var(--soft)}
.pgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:14px 0 8px}
.pcard{display:flex;gap:12px;align-items:flex-start;border:1px solid var(--line);border-radius:14px;padding:16px;color:var(--text);transition:border-color .15s,box-shadow .15s}.pcard:hover{border-color:var(--accent);box-shadow:0 10px 24px rgba(15,23,42,.06)}.pname{color:var(--text)}
.pcard img{border-radius:10px;flex:none}.pcard b{display:block}.pcard small{display:block;color:var(--muted);font-size:14px;margin:3px 0 6px}.pcard em{font-style:normal;font-size:13px;color:var(--accent);font-weight:600}
.upsell{display:flex;gap:18px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.tools-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:18px 0 40px}.tools-grid a{display:block;border:1px solid var(--line);border-radius:14px;padding:18px;color:var(--text)}
.tools-grid a:hover{border-color:var(--accent);text-decoration:none}.tools-grid small{display:block;color:var(--muted);margin-top:6px;font-size:14px}
@media (max-width:900px){.pgrid{grid-template-columns:1fr}.tool,.doc-tool{grid-template-columns:1fr}.tool-out{position:static}.fgrid{grid-template-columns:1fr}.doc-2{grid-template-columns:1fr}.tools-grid{grid-template-columns:1fr}.doc{padding:20px}}
@media print{.top,.foot,.crumbs,.wrap>h1,.wrap>.lead,.tool-form,.doc-actions,.after,.pgrid,.free-faq{display:none!important}main .wrap{max-width:none;padding:0}.tool{display:block;margin:0}.tool-out{position:static}.doc{border:0;box-shadow:none;padding:0}}
</style>`;

const DISCLOSURE = 'Some links are referral links: HaulPanel may earn a fee if you sign up, at no cost to you. We only list services that are useful to truckers.';
const visit = (p: Partner, from: string) => `<a href="${goHref(p.id, from)}" target="_blank" rel="sponsored nofollow noopener">Visit ${esc(p.name)} ↗</a>`;
/** A company card: its page on HaulPanel when there is one, and the way to the company itself. */
const partnerCard = (p: Partner, from: string) => PROFILES[p.id]
  ? `<div class="pcard"><img src="/logos/${p.id}.png" alt="" width="40" height="40" loading="lazy"><span><a class="pname" href="${profilePath(p.id)}"><b>${esc(p.name)}</b></a><small>${esc(p.blurb)}</small><em><a href="${profilePath(p.id)}">Read more</a> · ${visit(p, from)}</em></span></div>`
  : `<div class="pcard"><img src="/logos/${p.id}.png" alt="" width="40" height="40" loading="lazy"><span><b>${esc(p.name)}</b><small>${esc(p.blurb)}</small><em>${esc(p.for)} · ${visit(p, from)}</em></span></div>`;

/** "Services that help" under a tool or guide. */
function partnerSection(ids: string[], from: string): string {
  const ps = ids.map(partner).filter((p): p is Partner => !!p);
  return `<h2 style="margin-top:36px">Services that help</h2><div class="pgrid">${ps.map((p) => partnerCard(p, from)).join('')}</div>
<p class="note">${esc(DISCLOSURE)} <a href="/trucking-services">All trucking services →</a></p>`;
}

/** /trucking-services: every recommended service by category. */
function servicesPage(): string {
  const body = `${FREE_CSS}<div class="wrap" style="padding-bottom:48px">
<h1 style="margin-top:28px">Trucking services we recommend</h1>
<p class="lead">Factoring, load boards, ELDs, fuel cards, insurance and the paperwork to start a trucking or dispatch business — the services our users ask about most.</p>
<h2 style="margin-top:28px">Compare before you choose</h2><div class="tools-grid">${Object.values(COMPARISONS).map((c) => `<a href="/trucking-services/${c.slug}"><b>${esc(c.h1)}</b><small>${esc(c.lead.slice(0, 120))}${c.lead.length > 120 ? '…' : ''}</small></a>`).join('')}</div>
${PARTNER_CATEGORIES.map((c) => {
    const ps = PARTNERS.filter((p) => p.category === c.id);
    return ps.length ? `<h2 style="margin-top:32px">${esc(c.name)}</h2><p class="muted">${esc(c.why)}</p><div class="pgrid">${ps.map((p) => partnerCard(p, 'trucking-services')).join('')}</div>` : '';
  }).join('')}
<p class="note" style="margin-top:28px">${esc(DISCLOSURE)}</p>
<div class="box upsell" style="margin-top:24px"><div><h3>Run it all from one board</h3><p class="muted" style="margin:0">HaulPanel sends invoices to your factoring company, connects your ELD and keeps every load, carrier and payment in one place — free during beta.</p></div><a class="btn primary" href="/#/crm?signup">Start free</a></div>
<p class="note">Also free: <a href="/free-trucking-tools">calculators, templates and guides</a> · <a href="/mc-number-lookup">MC number lookup</a> · <a href="/new-mc-leads">New MC leads</a></p>
</div>`;
  return page({
    path: '/trucking-services', title: 'Trucking Services for Carriers & Dispatchers — Factoring, Load Boards, ELD, Fuel Cards',
    description: 'Services for owner-operators, small fleets and dispatchers: freight factoring, load boards, ELD, fuel cards, insurance, LLC formation and bookkeeping — in one list.',
    body, jsonLd: [{ '@context': 'https://schema.org', '@type': 'ItemList', name: 'Trucking services', itemListElement: PARTNERS.map((p, i) => ({ '@type': 'ListItem', position: i + 1, name: p.name, url: p.url })) }],
  });
}

/** A free tool or guide page, or null for other paths. */
export function freePage(path: string): string | null {
  if (path === '/free-trucking-tools') return hubPage();
  if (path === '/trucking-services') return servicesPage();
  const f = FREE[path];
  if (!f) return null;
  const others = Object.entries(FREE).filter(([p]) => p !== path).slice(0, 9);
  const body = `${FREE_CSS}<div class="wrap">
<nav class="crumbs"><a href="/free-trucking-tools">Free trucking tools</a> › ${esc(f.name)}</nav>
<h1>${esc(f.h1)}</h1><p class="lead">${esc(f.lead)}</p>
${f.body}
<div class="after">
${f.partners?.length ? partnerSection(f.partners, path.slice(1)) : ''}
<div class="box upsell"><div><h3>Do this automatically</h3><p class="muted" style="margin:0">${esc(f.upsell)}</p></div><a class="btn primary" href="/#/crm?signup">Try HaulPanel free</a></div>
<div class="free-faq"><h2 style="margin-top:36px">Questions</h2>${f.faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</div>
<h2 style="margin-top:36px">More free tools</h2>
<div class="tools-grid">${others.map(([p, o]) => `<a href="${p}"><b>${esc(o.name)}</b><small>${esc(o.lead.slice(0, 110))}${o.lead.length > 110 ? '…' : ''}</small></a>`).join('')}</div>
</div></div>${f.script ? `<script>${f.script}</script>` : ''}`;
  const ld: object[] = [
    f.kind === 'tool'
      ? { '@context': 'https://schema.org', '@type': 'WebApplication', name: f.h1, url: SITE + path, applicationCategory: 'BusinessApplication', operatingSystem: 'Web browser', description: f.description, offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }, publisher: { '@type': 'Organization', name: 'HaulPanel', url: SITE } }
      : { '@context': 'https://schema.org', '@type': 'Article', headline: f.h1, description: f.description, url: SITE + path, datePublished: PUBLISHED, dateModified: PUBLISHED, author: { '@type': 'Organization', name: 'HaulPanel', url: SITE }, publisher: { '@type': 'Organization', name: 'HaulPanel', url: SITE, logo: { '@type': 'ImageObject', url: `${SITE}/logo.png` } } },
    { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: f.faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Free trucking tools', item: `${SITE}/free-trucking-tools` }, { '@type': 'ListItem', position: 2, name: f.name, item: SITE + path }] },
  ];
  return page({ path, title: f.title, description: f.description, body, jsonLd: ld });
}

function hubPage(): string {
  const tools = Object.entries(FREE).filter(([, f]) => f.kind === 'tool');
  const guides = Object.entries(FREE).filter(([, f]) => f.kind === 'guide');
  const card = ([p, f]: [string, FreePage]) => `<a href="${p}"><b>${esc(f.name)}</b><small>${esc(f.lead)}</small></a>`;
  const body = `${FREE_CSS}<div class="wrap" style="padding-bottom:48px">
<h1>Free trucking tools</h1>
<p class="lead">Calculators, document templates and guides for truck dispatchers, owner-operators and freight brokers. Free, no sign-up — everything you type stays in your browser.</p>
<h2 style="margin-top:28px">Calculators and templates</h2><div class="tools-grid">${tools.map(card).join('')}
<a href="/mc-number-lookup"><b>MC number lookup</b><small>Check any carrier or broker by MC, USDOT, phone or email: authority, insurance, fraud signs.</small></a>
<a href="/new-mc-leads"><b>New MC leads</b><small>Carriers and brokers that just got their authority, with phone and email, every day.</small></a>
<a href="/carriers"><b>Trucking company directory</b><small>Every active carrier and broker by state and city.</small></a></div>
<h2>Guides</h2><div class="tools-grid">${guides.map(card).join('')}
<a href="/trucking-services"><b>Trucking services we recommend</b><small>Factoring, load boards, ELD, fuel cards, insurance and LLC setup in one list.</small></a></div>
<div class="box upsell"><div><h3>All of this in one TMS</h3><p class="muted" style="margin:0">HaulPanel: loads, rate cons read by AI, invoices with documents, carrier statements and FMCSA checks — free during beta.</p></div><a class="btn primary" href="/#/crm?signup">Start free</a></div>
</div>`;
  return page({
    path: '/free-trucking-tools', title: 'Free Trucking Tools — Calculators, Templates & Guides for Dispatchers',
    description: 'Free tools for truck dispatchers, carriers and brokers: rate per mile, fuel cost and detention calculators, invoice, rate confirmation, dispatch agreement and carrier packet templates, and practical guides.',
    body, jsonLd: [{ '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'Free trucking tools', url: `${SITE}/free-trucking-tools`, hasPart: Object.keys(FREE).map((p) => ({ '@type': 'WebPage', url: SITE + p, name: FREE[p].name })) }],
  });
}
