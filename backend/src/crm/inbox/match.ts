import { straightMiles } from '../miles.js';
import type { PostingFields } from './read-email.js';

// Which truck fits a posted load: the closest truck that's free (or about to be), with the driver's hours left.
// Distances are straight-line × 1.2 (a road estimate shown as "~"); the map isn't called for every posting.

const ROAD = 1.2;
type Pt = { lat: number; lon: number };

export interface TruckNow {
  id: number;
  unit: string;
  driver: string;
  /** Where it is now (ELD or the driver's Telegram), if known. */
  at: Pt | null;
  /** Where it is now, as words (ELD address), if known. */
  where: string;
  /** It's on a load: where that load delivers (then the truck is free there). */
  busyUntil: { place: Pt; name: string; date: string } | null;
  driveLeftMin: number | null;
}

export interface Match {
  truckId: number;
  unit: string;
  driver: string;
  /** Empty miles to the pickup (estimate). */
  deadhead: number;
  /** From where: the truck's position now, or the delivery of its current load. */
  from: string;
  driveLeftMin: number | null;
}

export interface Fit {
  loadedMiles: number;
  /** Posted rate per loaded mile (0 if no rate). */
  rpm: number;
  best: Match | null;
  /** The posting passes the autopilot rules (rate, deadhead, a free truck). */
  ok: boolean;
  why: string;
}

export interface Rules { minRpm: number; maxDeadhead: number }

/** How a posting fits the fleet. `find` turns "City, ST" into a point (null if unknown). */
export function fit(p: PostingFields, trucks: TruckNow[], find: (place: string) => Pt | null, rules: Rules): Fit {
  const a = p.origin ? find(p.origin) : null;
  const b = p.destination ? find(p.destination) : null;
  const loadedMiles = p.miles > 0 ? p.miles : a && b ? Math.round(straightMiles(a, b) * ROAD) : 0;
  const rpm = p.rate > 0 && loadedMiles > 0 ? Math.round((p.rate / loadedMiles) * 100) / 100 : 0;
  let best: Match | null = null;
  if (a) {
    for (const t of trucks) {
      const start = t.busyUntil ? { pt: t.busyUntil.place, from: `after delivery in ${t.busyUntil.name}` } : t.at ? { pt: t.at, from: t.where || 'current location' } : null;
      if (!start) continue;
      // Busy trucks only fit if their delivery is before the pickup.
      if (t.busyUntil && p.pickup_date && t.busyUntil.date > p.pickup_date) continue;
      const deadhead = Math.round(straightMiles(start.pt, a) * ROAD);
      if (!best || deadhead < best.deadhead) best = { truckId: t.id, unit: t.unit, driver: t.driver, deadhead, from: start.from, driveLeftMin: t.driveLeftMin };
    }
  }
  const why = !a ? 'pickup place unknown'
    : !best ? 'no free truck with a known location'
    : best.deadhead > rules.maxDeadhead ? `closest truck is ~${best.deadhead} mi away`
    : rules.minRpm > 0 && rpm > 0 && rpm < rules.minRpm ? `$${rpm.toFixed(2)}/mi is under $${rules.minRpm.toFixed(2)}`
    : best.driveLeftMin != null && best.driveLeftMin < 60 && !p.pickup_date ? 'driver is out of hours'
    : '';
  return { loadedMiles, rpm, best, ok: !why, why };
}

/** A posting's identity, so the same load from two alerts is kept once. */
export function postingKey(p: PostingFields): string {
  const n = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  return p.ref ? `${n(p.broker)}|${n(p.ref)}` : [n(p.broker), n(p.origin), n(p.destination), p.pickup_date, p.rate].join('|');
}

/** The first email to a broker about a posted load: short, with the truck and the question. */
export function inquiry(p: PostingFields, m: Match | null, co: { name: string; mc: string; phone: string }, me: string): { subject: string; body: string } {
  const lane = `${p.origin || '?'} → ${p.destination || '?'}`;
  const date = p.pickup_date ? ` on ${p.pickup_date.slice(5).replace('-', '/')}` : '';
  const first = p.contact.split(/\s+/)[0];
  const truck = m ? ` We have a truck${m.deadhead > 0 ? ` about ${m.deadhead} mi from the pickup` : ' near the pickup'}${m.from.startsWith('after delivery') ? `, ${m.from}` : ''}.` : '';
  const rate = p.rate > 0 ? ` Is $${p.rate.toLocaleString('en-US')} firm, or is there room?` : ' What rate can you do?';
  return {
    subject: `${lane}${date}${p.ref ? ` · ref ${p.ref}` : ''} · truck available`,
    body: `Hello${first ? ` ${first}` : ''},\n\nIs your load ${lane}${date}${p.ref ? ` (ref ${p.ref})` : ''}${p.equipment ? `, ${p.equipment}` : ''} still available?${truck}${rate}\n\nThank you,\n${[me, co.name, co.mc && `MC ${co.mc}`, co.phone].filter(Boolean).join('\n')}`,
  };
}
