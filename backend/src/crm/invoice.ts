import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';

// The invoice a dispatcher sends to the broker for a load, in the carrier's name, as one PDF "packet":
// the invoice page, then the rate confirmation, BOL and POD that go with it (PDF pages copied, photos as pages).

export interface InvoiceParty { name: string; mc?: string; phone?: string; email?: string }
export interface InvoiceData {
  number: string;
  /** YYYY-MM-DD */
  date: string;
  due: string;
  termsDays: number;
  from: InvoiceParty;
  /** Factoring company the broker should pay instead of the carrier, if any. */
  remitTo?: string;
  billTo: InvoiceParty;
  load: { pro: string; pickupDate: string; origin: string; destination: string; miles: number; truck?: string; driver?: string };
  lines: { label: string; amount: number }[];
  notes?: string;
}
export interface Attachment { name: string; mime: string; data: Uint8Array }

/** Helvetica can only write Latin-1: arrows and other symbols become plain text, anything else is dropped. */
const safe = (s: string) => s.replace(/[→⟶]/g, '->').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/·/g, '-')
  .replace(/[^\x20-\x7E\xA0-\xFF]/g, '');
const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export const invoiceTotal = (d: Pick<InvoiceData, 'lines'>) => Math.round(d.lines.reduce((s, l) => s + l.amount, 0) * 100) / 100;

export async function buildInvoicePdf(d: InvoiceData, attachments: Attachment[] = []): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Invoice ${d.number}`);
  pdf.setAuthor(d.from.name);
  pdf.setCreator('HaulPanel');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([612, 792]); // US Letter
  drawInvoice(page, d, font, bold, attachments.length > 0);

  for (const a of attachments) {
    try {
      if (a.mime === 'application/pdf') {
        const src = await PDFDocument.load(a.data, { ignoreEncryption: true });
        for (const p of await pdf.copyPages(src, src.getPageIndices())) pdf.addPage(p);
      } else if (a.mime === 'image/jpeg' || a.mime === 'image/png') {
        const img = a.mime === 'image/png' ? await pdf.embedPng(a.data) : await pdf.embedJpg(a.data);
        const p = pdf.addPage([612, 792]);
        const scale = Math.min(572 / img.width, 752 / img.height, 1.5);
        p.drawImage(img, { x: (612 - img.width * scale) / 2, y: (792 - img.height * scale) / 2, width: img.width * scale, height: img.height * scale });
      }
    } catch {
      // A broken or protected file is left out rather than failing the whole invoice.
    }
  }
  return pdf.save();
}

function drawInvoice(page: PDFPage, d: InvoiceData, font: PDFFont, bold: PDFFont, withDocs: boolean) {
  const ink = rgb(0.07, 0.09, 0.16), muted = rgb(0.4, 0.45, 0.53), line = rgb(0.86, 0.88, 0.91), accent = rgb(0.15, 0.39, 0.92);
  const text = (s: string, x: number, y: number, o: { size?: number; f?: PDFFont; color?: typeof ink; right?: boolean } = {}) => {
    const t = safe(s), size = o.size ?? 10, f = o.f ?? font;
    page.drawText(t, { x: o.right ? x - f.widthOfTextAtSize(t, size) : x, y, size, font: f, color: o.color ?? ink });
  };
  const rule = (y: number) => page.drawLine({ start: { x: 48, y }, end: { x: 564, y }, thickness: 0.8, color: line });

  // Header: who bills, and the invoice number and dates.
  text(d.from.name, 48, 730, { size: 18, f: bold });
  let y = 712;
  for (const s of [d.from.mc && `MC ${d.from.mc}`, d.from.phone, d.from.email].filter(Boolean) as string[]) { text(s, 48, y, { color: muted }); y -= 14; }
  text('INVOICE', 564, 730, { size: 22, f: bold, color: accent, right: true });
  text(`# ${d.number}`, 564, 710, { size: 11, f: bold, right: true });
  text(`Date: ${fmtDate(d.date)}`, 564, 694, { color: muted, right: true });
  text(`Due: ${fmtDate(d.due)} (net ${d.termsDays})`, 564, 680, { color: muted, right: true });
  rule(650);

  // Bill to / remit to
  text('BILL TO', 48, 628, { size: 8.5, f: bold, color: muted });
  text(d.billTo.name || 'Broker', 48, 612, { size: 12, f: bold });
  y = 597;
  for (const s of [d.billTo.mc && `MC ${d.billTo.mc}`, d.billTo.email].filter(Boolean) as string[]) { text(s, 48, y, { color: muted }); y -= 14; }
  text('REMIT PAYMENT TO', 330, 628, { size: 8.5, f: bold, color: muted });
  text(d.remitTo || d.from.name, 330, 612, { size: 12, f: bold });
  if (d.remitTo) text(`Factoring company of ${d.from.name}`, 330, 597, { color: muted });

  // The load
  page.drawRectangle({ x: 48, y: 470, width: 516, height: 80, color: rgb(0.97, 0.98, 0.99), borderColor: line, borderWidth: 0.8 });
  const cell = (label: string, value: string, x: number, yy: number) => { text(label, x, yy, { size: 8.5, f: bold, color: muted }); text(value || '-', x, yy - 15, { size: 10.5 }); };
  cell('LOAD # / PRO#', d.load.pro, 62, 532);
  cell('PICKUP DATE', fmtDate(d.load.pickupDate), 230, 532);
  cell('LOADED MILES', d.load.miles ? d.load.miles.toLocaleString('en-US') : '', 400, 532);
  cell('LANE', `${d.load.origin || '-'}  ->  ${d.load.destination || '-'}`, 62, 494);
  cell('TRUCK / DRIVER', [d.load.truck && `#${d.load.truck}`, d.load.driver].filter(Boolean).join(' - '), 400, 494);

  // Charges
  y = 438;
  text('DESCRIPTION', 48, y, { size: 8.5, f: bold, color: muted });
  text('AMOUNT', 564, y, { size: 8.5, f: bold, color: muted, right: true });
  rule(y - 8);
  y -= 26;
  for (const l of d.lines) {
    text(l.label, 48, y, { size: 10.5 });
    text(usd(l.amount), 564, y, { size: 10.5, right: true });
    y -= 22;
  }
  rule(y + 10);
  text('TOTAL DUE', 400, y - 10, { size: 11, f: bold });
  text(usd(invoiceTotal(d)), 564, y - 12, { size: 16, f: bold, color: accent, right: true });

  if (d.notes) {
    text('NOTES', 48, y - 56, { size: 8.5, f: bold, color: muted });
    let ny = y - 72;
    for (const chunk of wrap(safe(d.notes), font, 10, 516).slice(0, 6)) { text(chunk, 48, ny, { color: muted }); ny -= 14; }
  }
  if (withDocs) text('The documents for this load (rate confirmation, BOL, POD) follow on the next pages.', 48, 64, { size: 9, color: muted });
  text('Thank you for your business.', 48, 50, { size: 9, color: muted });
}

function wrap(s: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of s.split('\n')) {
    let cur = '';
    for (const w of para.split(/\s+/)) {
      const next = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) > width && cur) { out.push(cur); cur = w; } else cur = next;
    }
    out.push(cur);
  }
  return out;
}
