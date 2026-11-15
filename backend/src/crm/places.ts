import { readFileSync } from 'node:fs';

// US cities and towns for "City, ST" suggestions while typing a lane, and their coordinates for miles.
// Data: GeoNames (https://www.geonames.org, CC BY 4.0), places with 500+ people — backend/geo/us-places.tsv,
// one place per line: name, ascii name (empty when the same), state, lat, lon, population; largest first.

export interface Place { name: string; state: string; lat: number; lon: number; pop: number; key: string; alt: string }
export interface PlaceHit { label: string; lat: number; lon: number }

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\bst\.?\s+/g, 'saint ').replace(/\bft\.?\s+/g, 'fort ').replace(/\bmt\.?\s+/g, 'mount ')
  .replace(/[^a-z0-9]+/g, ' ').trim();

const STATE_CODES = new Set(('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK '
  + 'OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR').split(' '));

/** "dallas, tx" → {city: "dallas", state: "TX"}; "dallas t" → state prefix "T"; "dallas" → no state. */
export function splitQuery(q: string): { city: string; state: string } {
  const s = q.trim();
  const comma = /^(.*?),\s*([A-Za-z]{0,2})\.?\s*(?:\d{5})?\s*$/.exec(s);
  if (comma) return { city: norm(comma[1]), state: comma[2].toUpperCase() };
  // "Santa Monica CA" (no comma): the last word is the state only if it is a real state code.
  const sp = /^(.*\S)\s+([A-Za-z]{2})\.?$/.exec(s);
  if (sp && STATE_CODES.has(sp[2].toUpperCase()) && norm(sp[1]).length >= 3) return { city: norm(sp[1]), state: sp[2].toUpperCase() };
  return { city: norm(s), state: '' };
}

export class PlacesService {
  private list: Place[] | null = null;

  constructor(private readonly file = new URL('../../geo/us-places.tsv', import.meta.url)) {}

  private places(): Place[] {
    if (this.list) return this.list;
    try {
      this.list = readFileSync(this.file, 'utf8').split('\n')
        .filter((l) => l && !l.startsWith('#'))
        .map((l) => {
          const [raw, ascii, state, lat, lon, pop] = l.split('\t');
          const name = raw === 'New York City' ? 'New York' : raw; // as dispatchers and rate cons write it
          return { name, state, lat: Number(lat), lon: Number(lon), pop: Number(pop), key: norm(name), alt: ascii ? norm(ascii) : '' };
        });
    } catch {
      this.list = [];
    }
    return this.list;
  }

  /**
   * Up to `limit` places whose name starts with what was typed (then names with a word starting with it), largest first.
   * "santa mo" is first read whole (Santa Monica), and only then as "Santa" in Missouri.
   */
  suggest(q: string, limit = 8): PlaceHit[] {
    const split = splitQuery(q);
    const whole = { city: norm(q.replace(/,/g, ' ')), state: '' };
    const out: Place[] = [];
    const seen = new Set<string>();
    for (const { city, state } of split.state && !q.includes(',') ? [whole, split] : [split]) {
      if (city.length < 2) continue;
      const inState = (p: Place) => !state || p.state.startsWith(state);
      const starts = (p: Place) => p.key.startsWith(city) || (p.alt !== '' && p.alt.startsWith(city));
      const word = (p: Place) => p.key.includes(` ${city}`);
      for (const test of [(p: Place) => p.key === city || p.alt === city, starts, word]) {
        for (const p of this.places()) {
          if (out.length >= limit) break;
          const id = `${p.key}|${p.state}`;
          if (!seen.has(id) && inState(p) && test(p)) { seen.add(id); out.push(p); }
        }
      }
    }
    // The list is largest first, so "Portland" gives Portland, OR before Portland, ME.
    return out.map((p) => ({ label: `${p.name}, ${p.state}`, lat: p.lat, lon: p.lon }));
  }

  /** Coordinates of "City, ST" when it names a known place exactly (the largest one of that name in that state). */
  find(text: string): { lat: number; lon: number } | null {
    const { city, state } = splitQuery(text);
    if (!city || state.length !== 2) return null;
    const p = this.places().find((x) => x.state === state && (x.key === city || x.alt === city));
    return p ? { lat: p.lat, lon: p.lon } : null;
  }
}
