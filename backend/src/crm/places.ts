import { readFileSync } from 'node:fs';

// US cities and towns for "City, ST" suggestions while typing a lane, and their coordinates for miles.
// Data: GeoNames (https://www.geonames.org, CC BY 4.0), places with 500+ people — backend/geo/us-places.tsv,
// one place per line: name, ascii name (empty when the same), state, lat, lon, population; largest first.

export interface Place { name: string; state: string; lat: number; lon: number; pop: number; key: string; alt: string }
export interface PlaceHit { label: string; lat: number; lon: number }

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\bst\.?\s+/g, 'saint ').replace(/\bft\.?\s+/g, 'fort ').replace(/\bmt\.?\s+/g, 'mount ')
  .replace(/[^a-z0-9]+/g, ' ').trim();

const STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', PR: 'Puerto Rico',
};
const CODES = Object.keys(STATE_NAMES);
// Longest first, so "Dallas West Virginia" is read as WV, not "Dallas West" in VA.
const NAMES = CODES.map((code) => ({ code, key: norm(STATE_NAMES[code]) })).sort((a, b) => b.key.length - a.key.length);

/** The state codes a typed state could be: "TX" → [TX]; "t" → [TN, TX]; "tex" or "Texas" → [TX]; "new" → [NH, NJ, NM, NY]. */
function statesFor(typed: string): string[] {
  const up = typed.trim().replace(/\.$/, '').toUpperCase();
  if (STATE_NAMES[up]) return [up];
  const key = norm(typed);
  const byCode = up.length === 1 ? CODES.filter((c) => c.startsWith(up)) : [];
  return [...new Set([...byCode, ...NAMES.filter((n) => n.key.startsWith(key)).map((n) => n.code)])];
}

/** The state code of a full state name: "new york" → NY. */
export const stateOfName = (s: string): string | undefined => NAMES.find((n) => n.key === norm(s))?.code;

/**
 * What is typed, as a city and the states it may be in (an empty list = any state).
 * "dallas, tx" / "Dallas, Texas" / "dallas texas" → dallas in [TX]; "dallas, t" → [TN, TX]; "dallas" → any.
 */
export function splitQuery(q: string): { city: string; states: string[] } {
  const s = q.trim();
  const comma = /^(.*?),\s*([A-Za-z][A-Za-z .]*?)?\.?\s*(?:\d{5})?\s*$/.exec(s);
  if (comma) {
    const states = comma[2] ? statesFor(comma[2]) : [];
    // A state that matches nothing ("Dallas, xq") must not mean "any state".
    return { city: norm(comma[1]), states: comma[2] && !states.length ? ['-'] : states };
  }
  // No comma: the end is the state only if it is a real state code ("Santa Monica CA") or a full state name ("Dallas Texas").
  const sp = /^(.*\S)\s+([A-Za-z]{2})\.?$/.exec(s);
  if (sp && STATE_NAMES[sp[2].toUpperCase()] && norm(sp[1]).length >= 3) return { city: norm(sp[1]), states: [sp[2].toUpperCase()] };
  const all = norm(s);
  const named = NAMES.find((n) => all.endsWith(` ${n.key}`) && all.length - n.key.length - 1 >= 3);
  if (named) return { city: all.slice(0, all.length - named.key.length - 1), states: [named.code] };
  return { city: all, states: [] };
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
   * A state name alone ("Texas", "California") gives that state's largest cities, after a big city of the same name
   * (New York, NY; Washington, DC) and before small towns called that (California, MD).
   */
  suggest(q: string, limit = 8): PlaceHit[] {
    const split = splitQuery(q);
    const whole = { city: norm(q.replace(/,/g, ' ')), states: [] as string[] };
    const out: Place[] = [];
    const seen = new Set<string>();
    const add = (test: (p: Place) => boolean) => {
      for (const p of this.places()) {
        if (out.length >= limit) return;
        const id = `${p.key}|${p.state}`;
        if (!seen.has(id) && test(p)) { seen.add(id); out.push(p); }
      }
    };
    const stateAlone = q.includes(',') ? undefined : stateOfName(q);
    if (stateAlone) {
      const key = norm(q);
      add((p) => (p.key === key || p.alt === key) && p.pop >= 50_000);
      add((p) => p.state === stateAlone);
    }
    for (const { city, states } of split.states.length && !q.includes(',') ? [whole, split] : [split]) {
      if (city.length < 2) continue;
      const inState = (p: Place) => !states.length || states.includes(p.state);
      const starts = (p: Place) => p.key.startsWith(city) || (p.alt !== '' && p.alt.startsWith(city));
      const word = (p: Place) => p.key.includes(` ${city}`);
      for (const test of [(p: Place) => p.key === city || p.alt === city, starts, word]) add((p) => inState(p) && test(p));
    }
    // The list is largest first, so "Portland" gives Portland, OR before Portland, ME.
    return out.map((p) => ({ label: `${p.name}, ${p.state}`, lat: p.lat, lon: p.lon }));
  }

  /** Coordinates of "City, ST" when it names a known place exactly (the largest one of that name in that state). */
  find(text: string): { lat: number; lon: number } | null {
    const { city, states } = splitQuery(text);
    if (!city || states.length !== 1) return null;
    const p = this.places().find((x) => x.state === states[0] && (x.key === city || x.alt === city));
    return p ? { lat: p.lat, lon: p.lon } : null;
  }
}
