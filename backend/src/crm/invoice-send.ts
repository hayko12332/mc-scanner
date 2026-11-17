import { NotFoundException } from '@nestjs/common';
import { sendMail } from '../mail/mailer.js';
import type { CrmStore } from './crm.store.js';
import type { CrmUser, Load } from './crm.types.js';
import { buildInvoicePdf, invoiceTotal, type InvoiceData } from './invoice.js';

// Building and emailing a load's invoice: used by the board's "Email invoice" button, by Ask AI, and by the
// Billing agent when it runs on its own.

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export const PAY_TERMS_DAYS = 30;

/** The invoice of one load: number, dates (net 30 from the invoice date), parties and charges. */
export function invoiceData(load: Load, o: { from: InvoiceData['from']; remitTo?: string; truck?: string; driver?: string; billEmail?: string }, today = new Date()): InvoiceData {
  const date = load.invoicedOn ?? today.toISOString().slice(0, 10);
  const due = new Date(date + 'T12:00:00Z');
  due.setUTCDate(due.getUTCDate() + PAY_TERMS_DAYS);
  const lines = [
    { label: 'Linehaul', amount: load.rate },
    { label: 'Detention', amount: load.detention },
    { label: 'Layover', amount: load.layover },
    { label: 'Truck order not used (TONU)', amount: load.tonu },
    { label: 'Other charges', amount: load.other },
    { label: 'Lumper (reimbursement, receipt attached)', amount: load.lumper },
  ].filter((l) => l.amount > 0);
  return {
    number: `INV-${String(load.id).padStart(5, '0')}`, date, due: due.toISOString().slice(0, 10), termsDays: PAY_TERMS_DAYS,
    from: o.from, remitTo: o.remitTo, billTo: { name: load.broker, mc: load.brokerMc || undefined, email: o.billEmail },
    load: { pro: load.pro, pickupDate: load.date, origin: load.origin, destination: load.destination, miles: load.loadedMiles, truck: o.truck, driver: o.driver },
    lines: lines.length ? lines : [{ label: 'Linehaul', amount: 0 }],
  };
}


/** What goes on a load's invoice: the carrier (or this company) bills the broker; the carrier's factoring gets paid. */
export async function invoiceParts(store: CrmStore, ws: number, user: CrmUser, id: number, attach: number[]) {
  const state = await store.state(ws, user);
  const load = state.loads.find((l) => l.id === id);
  if (!load) throw new NotFoundException();
  const carrier = state.carriers.find((c) => c.id === load.carrierId);
  const truck = state.trucks.find((t) => t.id === load.truckId);
  const data = invoiceData(load, {
    from: carrier
      ? { name: carrier.name, mc: carrier.mc.replace(/\D/g, ''), phone: carrier.phone, email: carrier.email }
      : { name: state.company.name || user.name, mc: state.company.mc, phone: state.company.phone, email: user.email },
    remitTo: carrier?.factoring || undefined, truck: truck?.unit, driver: truck?.driver,
    billEmail: state.brokerEmails[load.broker.trim().toLowerCase()],
  });
  const files = await store.filesOf(ws, id, attach);
  return { load, data, files };
}

/** Emails the invoice PDF (with the chosen documents) to the broker; replies go to `user`. Marks the load invoiced. */
export async function sendLoadInvoice(store: CrmStore, ws: number, user: CrmUser, id: number, to: string, cc: string[], attach: number[], remind: boolean, note: string) {
  const { load, data, files } = await invoiceParts(store, ws, user, id, attach);
  const pdf = await buildInvoicePdf(data, files);
  const lane = `${data.load.origin || '—'} → ${data.load.destination || '—'}`;
  const total = invoiceTotal(data).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  const docs = files.map((f) => f.kind === 'pod' ? 'POD' : f.kind === 'bol' ? 'BOL' : f.kind === 'ratecon' ? 'rate confirmation' : f.name);
  await sendMail({
    to, cc, fromName: `${data.from.name} via HaulPanel`, replyTo: user.email,
    subject: `Invoice ${data.number} · Load ${load.pro || load.id} · ${data.from.name}`,
    text: `Hello,\n\nPlease find attached invoice ${data.number} for load ${load.pro || load.id} (${lane}), ${total}, due ${data.due}.${docs.length ? `\nAttached in the same PDF: ${docs.join(', ')}.` : ''}${note ? `\n\n${note}` : ''}${data.remitTo ? `\n\nPlease remit payment to ${data.remitTo}.` : ''}\n\nThank you,\n${user.name || data.from.name}\n${data.from.name}${data.from.phone ? ` · ${data.from.phone}` : ''}`,
    html: `<p>Hello,</p><p>Please find attached invoice <b>${esc(data.number)}</b> for load <b>${esc(load.pro || String(load.id))}</b> (${esc(lane)}), <b>${total}</b>, due ${esc(data.due)}.${docs.length ? `<br>Attached in the same PDF: ${esc(docs.join(', '))}.` : ''}</p>${note ? `<p>${esc(note).replace(/\n/g, '<br>')}</p>` : ''}${data.remitTo ? `<p>Please remit payment to <b>${esc(data.remitTo)}</b>.</p>` : ''}<p>Thank you,<br>${esc(user.name || data.from.name)}<br>${esc(data.from.name)}${data.from.phone ? ` · ${esc(data.from.phone)}` : ''}</p>`,
    attachments: [{ filename: `Invoice-${data.number}.pdf`, content: pdf }],
  });
  await store.invoiceSent(ws, load as Load, data.number, to, remind, new Date().toISOString().slice(0, 10));
  return { number: data.number, to };
}
