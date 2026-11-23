import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import { sendMail } from '../mail/mailer.js';
import type { CrmStore } from './crm.store.js';
import { isBrokerage, type CrmUser, type Load } from './crm.types.js';
import { fmtDate, safe, usd, wrap } from './invoice.js';
import { PAY_TERMS_DAYS } from './invoice-send.js';

// Brokerage boards: the rate confirmation the broker sends the carrier it booked on a load — who hauls it, the lane
// and dates, what the carrier is paid, and a line for the carrier to sign. Emailed from the board; a copy is kept with
// the load as a "carrier_rc" document, which is never attached to the customer's invoice (it shows the carrier's pay).

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export interface CarrierRateCon {
  number: string;
  date: string;
  broker: { name: string; mc: string; phone: string; email: string; contact: string };
  carrier: { name: string; mc: string; dot: string; phone: string; email: string };
  load: { pro: string; pickupDate: string; origin: string; destination: string; miles: number; truck: string; driver: string; notes: string };
  pay: { label: string; amount: number }[];
  termsDays: number;
}

export const carrierRcTotal = (d: Pick<CarrierRateCon, 'pay'>) => Math.round(d.pay.reduce((s, l) => s + l.amount, 0) * 100) / 100;

export function carrierRcData(load: Load, o: { broker: CarrierRateCon['broker']; carrier: CarrierRateCon['carrier']; truck?: string; driver?: string }, today = new Date()): CarrierRateCon {
  return {
    number: `RC-${String(load.id).padStart(5, '0')}`, date: today.toISOString().slice(0, 10), broker: o.broker, carrier: o.carrier,
    load: { pro: load.pro, pickupDate: load.date, origin: load.origin, destination: load.destination, miles: load.loadedMiles, truck: o.truck ?? '', driver: o.driver ?? '', notes: load.notes },
    pay: [{ label: 'Linehaul, all-in (incl. fuel)', amount: load.carrierPay ?? 0 }],
    termsDays: PAY_TERMS_DAYS,
  };
}

/** The rate con of a load on a brokerage board, from the board's data (the carrier must be chosen and paid > 0). */
export async function carrierRcParts(store: CrmStore, ws: number, user: CrmUser, id: number) {
  const st = await store.state(ws, user);
  if (!isBrokerage(st.company)) throw new BadRequestException('Carrier rate cons are for brokerage boards');
  const load = st.loads.find((l) => l.id === id);
  if (!load) throw new NotFoundException();
  const carrier = st.carriers.find((c) => c.id === load.carrierId);
  if (!carrier) throw new BadRequestException('Choose the carrier of this load first');
  if (!(load.carrierPay && load.carrierPay > 0)) throw new BadRequestException('Enter the carrier pay first');
  const truck = st.trucks.find((t) => t.id === load.truckId);
  const data = carrierRcData(load, {
    broker: { name: st.company.name || user.name, mc: st.company.mc, phone: st.company.phone, email: user.email, contact: user.name },
    carrier: { name: carrier.name, mc: carrier.mc.replace(/\D/g, ''), dot: carrier.dot.replace(/\D/g, ''), phone: carrier.phone, email: carrier.email },
    truck: truck?.unit, driver: truck?.driver,
  });
  return { load, carrier, data };
}

export async function buildCarrierRcPdf(d: CarrierRateCon): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Rate confirmation ${d.number}`);
  pdf.setAuthor(d.broker.name);
  pdf.setCreator('HaulPanel');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  draw(pdf.addPage([612, 792]), d, font, bold);
  return pdf.save();
}

function draw(page: PDFPage, d: CarrierRateCon, font: PDFFont, bold: PDFFont) {
  const ink = rgb(0.07, 0.09, 0.16), muted = rgb(0.4, 0.45, 0.53), line = rgb(0.86, 0.88, 0.91), accent = rgb(0.15, 0.39, 0.92);
  const text = (s: string, x: number, y: number, o: { size?: number; f?: PDFFont; color?: typeof ink; right?: boolean } = {}) => {
    const t = safe(s), size = o.size ?? 10, f = o.f ?? font;
    page.drawText(t, { x: o.right ? x - f.widthOfTextAtSize(t, size) : x, y, size, font: f, color: o.color ?? ink });
  };
  const rule = (y: number) => page.drawLine({ start: { x: 48, y }, end: { x: 564, y }, thickness: 0.8, color: line });

  text(d.broker.name, 48, 730, { size: 18, f: bold });
  let y = 712;
  for (const s of [d.broker.mc && `MC ${d.broker.mc}`, d.broker.phone, d.broker.email].filter(Boolean) as string[]) { text(s, 48, y, { color: muted }); y -= 14; }
  text('RATE CONFIRMATION', 564, 730, { size: 16, f: bold, color: accent, right: true });
  text(`# ${d.number}`, 564, 710, { size: 11, f: bold, right: true });
  text(`Date: ${fmtDate(d.date)}`, 564, 694, { color: muted, right: true });
  rule(660);

  text('CARRIER', 48, 638, { size: 8.5, f: bold, color: muted });
  text(d.carrier.name, 48, 622, { size: 12, f: bold });
  y = 607;
  for (const s of [[d.carrier.mc && `MC ${d.carrier.mc}`, d.carrier.dot && `DOT ${d.carrier.dot}`].filter(Boolean).join('  '), d.carrier.phone, d.carrier.email].filter(Boolean)) { text(s, 48, y, { color: muted }); y -= 14; }
  text('BROKER CONTACT', 330, 638, { size: 8.5, f: bold, color: muted });
  text(d.broker.contact || d.broker.name, 330, 622, { size: 12, f: bold });
  if (d.broker.phone || d.broker.email) text([d.broker.phone, d.broker.email].filter(Boolean).join('  '), 330, 607, { color: muted });

  page.drawRectangle({ x: 48, y: 480, width: 516, height: 80, color: rgb(0.97, 0.98, 0.99), borderColor: line, borderWidth: 0.8 });
  const cell = (label: string, value: string, x: number, yy: number) => { text(label, x, yy, { size: 8.5, f: bold, color: muted }); text(value || '-', x, yy - 15, { size: 10.5 }); };
  cell('LOAD #', d.load.pro || d.number, 62, 542);
  cell('PICKUP DATE', fmtDate(d.load.pickupDate), 230, 542);
  cell('LOADED MILES', d.load.miles ? d.load.miles.toLocaleString('en-US') : '', 400, 542);
  cell('PICKUP  ->  DELIVERY', `${d.load.origin || '-'}  ->  ${d.load.destination || '-'}`, 62, 504);
  cell('TRUCK / DRIVER', [d.load.truck && `#${d.load.truck}`, d.load.driver].filter(Boolean).join(' - '), 400, 504);

  y = 450;
  text('CARRIER PAY', 48, y, { size: 8.5, f: bold, color: muted });
  text('AMOUNT', 564, y, { size: 8.5, f: bold, color: muted, right: true });
  rule(y - 8);
  y -= 26;
  for (const l of d.pay) { text(l.label, 48, y, { size: 10.5 }); text(usd(l.amount), 564, y, { size: 10.5, right: true }); y -= 22; }
  rule(y + 10);
  text('TOTAL', 400, y - 10, { size: 11, f: bold });
  text(usd(carrierRcTotal(d)), 564, y - 12, { size: 16, f: bold, color: accent, right: true });
  y -= 50;

  if (d.load.notes.trim()) {
    text('INSTRUCTIONS', 48, y, { size: 8.5, f: bold, color: muted });
    y -= 16;
    for (const chunk of wrap(safe(d.load.notes), font, 10, 516).slice(0, 8)) { text(chunk, 48, y); y -= 14; }
    y -= 10;
  }
  text('PAYMENT', 48, y, { size: 8.5, f: bold, color: muted });
  y -= 16;
  for (const chunk of wrap(`Carrier is paid within ${d.termsDays} days after ${d.broker.name} receives the carrier's invoice and the signed POD for this load. Send them to ${d.broker.email || d.broker.name}.`, font, 10, 516)) { text(chunk, 48, y); y -= 14; }

  rule(120);
  text('Carrier signature', 48, 100, { size: 9, color: muted });
  page.drawLine({ start: { x: 48, y: 76 }, end: { x: 300, y: 76 }, thickness: 0.8, color: ink });
  text('Name and date', 330, 100, { size: 9, color: muted });
  page.drawLine({ start: { x: 330, y: 76 }, end: { x: 564, y: 76 }, thickness: 0.8, color: ink });
  text('Please sign and return this confirmation before pickup.', 48, 52, { size: 9, color: muted });
}

/** Emails the rate con to the carrier (replies go to the user) and keeps a copy with the load. */
export async function sendCarrierRc(store: CrmStore, ws: number, user: CrmUser, id: number, to: string, note: string) {
  const { load, data } = await carrierRcParts(store, ws, user, id);
  const pdf = Buffer.from(await buildCarrierRcPdf(data));
  const lane = `${data.load.origin || '—'} → ${data.load.destination || '—'}`;
  const total = carrierRcTotal(data).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  const ref = load.pro || data.number;
  const sign = `${user.name || data.broker.name}\n${data.broker.name}${data.broker.mc ? ` · MC ${data.broker.mc}` : ''}${data.broker.phone ? ` · ${data.broker.phone}` : ''}`;
  await sendMail({
    to, fromName: `${data.broker.name} via HaulPanel`, replyTo: user.email,
    subject: `Rate confirmation · Load ${ref} · ${lane} · ${total}`,
    text: `Hello,\n\nPlease find attached the rate confirmation for load ${ref} (${lane}), pickup ${data.load.pickupDate}, ${total}. Please sign and send it back before pickup.${note ? `\n\n${note}` : ''}\n\nThank you,\n${sign}`,
    html: `<p>Hello,</p><p>Please find attached the rate confirmation for load <b>${esc(ref)}</b> (${esc(lane)}), pickup ${esc(data.load.pickupDate)}, <b>${total}</b>. Please sign and send it back before pickup.</p>${note ? `<p>${esc(note).replace(/\n/g, '<br>')}</p>` : ''}<p>Thank you,<br>${esc(sign).replace(/\n/g, '<br>')}</p>`,
    attachments: [{ filename: `RateCon-${ref.replace(/[^\w-]/g, '') || data.number}.pdf`, content: pdf }],
  });
  await store.addFile(ws, id, { kind: 'carrier_rc', name: `Rate con ${data.number} (sent ${data.date}).pdf`, mime: 'application/pdf', data: pdf }).catch(() => undefined);
  return { number: data.number, to };
}
