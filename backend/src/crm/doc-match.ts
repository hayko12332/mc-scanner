import type { DeliveryDocFields } from './ai.js';
import type { CrmFile } from './crm.store.js';
import type { Load } from './crm.types.js';

// Which load a BOL or POD belongs to: a reference number printed on it that is the load # (or is in the load's notes)
// settles it; otherwise the lane and the dates point to the likely load. Pure, so it is tested without the AI.

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const city = (p: string) => {
  const [c = '', st = ''] = p.toLowerCase().split(',').map((x) => x.trim());
  return { c: c.replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim(), st: st.slice(0, 2) };
};
const samePlace = (a: string, b: string) => {
  const x = city(a), y = city(b);
  return !!x.c && x.c === y.c && (!x.st || !y.st || x.st === y.st);
};
const days = (a: string, b: string) => Math.abs(Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000;
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

export interface DocMatch {
  /** The load it surely belongs to, or null when unsure (the user picks). */
  loadId: number | null;
  why: string;
  /** Best guesses, most likely first (at most 3). */
  candidates: { loadId: number; score: number; why: string }[];
}

export function matchDoc(doc: Pick<DeliveryDocFields, 'kind' | 'references' | 'origin' | 'destination' | 'pickupDate' | 'deliveryDate' | 'shipper' | 'consignee'>,
  loads: Load[], files: Pick<CrmFile, 'loadId' | 'kind'>[] = []): DocMatch {
  const refs = doc.references.map(norm).filter((r) => r.length >= 3);
  const scored = loads.map((l) => {
    let score = 0;
    const why: string[] = [];
    const pro = norm(l.pro);
    const notes = norm(l.notes);
    const ref = refs.find((r) => (pro && r === pro) || (r.length >= 5 && notes.includes(r)) || (pro.length >= 5 && r.includes(pro)));
    if (ref) { score += 100; why.push(pro && (ref === pro || ref.includes(pro)) ? `load # ${l.pro}` : 'a reference in the notes'); }
    if (doc.origin && samePlace(doc.origin, l.origin)) { score += 20; why.push('pickup city'); }
    if (doc.destination && samePlace(doc.destination, l.destination)) { score += 20; why.push('delivery city'); }
    if (isDate(doc.pickupDate)) {
      const d = days(doc.pickupDate, l.date);
      if (d === 0) { score += 15; why.push('pickup date'); } else if (d <= 3) { score += 8; why.push('pickup date ±3 days'); }
    } else if (isDate(doc.deliveryDate) && doc.deliveryDate >= l.date && days(doc.deliveryDate, l.date) <= 10) score += 5;
    for (const n of [doc.shipper, doc.consignee].map(norm)) if (n.length >= 4 && notes.includes(n)) { score += 10; why.push('company in the notes'); break; }
    if (score > 0) {
      if (l.status === 'booked' || l.status === 'in_transit') score += 5;
      if (doc.kind === 'pod' && files.some((f) => f.loadId === l.id && f.kind === 'pod')) score -= 10;
    }
    return { loadId: l.id, score, why: why.join(', ') };
  }).filter((x) => x.score >= 20).sort((a, b) => b.score - a.score);

  const [top, next] = scored;
  const sure = !!top && (top.score >= 100 ? !next || next.score < 100 : top.score >= 40 && (!next || top.score - next.score >= 15));
  return {
    loadId: sure ? top.loadId : null,
    why: sure ? `Matched by ${top.why}` : top ? 'Not sure which load — pick it' : 'No load on the board matches — pick it',
    candidates: scored.slice(0, 3),
  };
}
