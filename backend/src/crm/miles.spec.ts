import { describe, expect, it } from 'vitest';
import { MilesService, placeKey, placeQuery, straightMiles } from './miles.js';

const json = (v: unknown) => new Response(JSON.stringify(v));

describe('Miles between places', () => {
  it('treats spelling variants of a place as the same', () => {
    expect(placeKey('PERU, IL, 61354')).toBe(placeKey('Peru IL 61354'));
  });

  it('looks up "City, ST" as that city in that state, so CO is Colorado and not a county', () => {
    expect(placeQuery('Aurora, CO')).toEqual({ city: 'Aurora', state: 'Colorado' });
    expect(placeQuery('PERU, IL, 61354')).toEqual({ city: 'PERU', state: 'Illinois', postalcode: '61354' });
    expect(placeQuery('Salt Lake City UT 84101-1234')).toEqual({ city: 'Salt Lake City', state: 'Utah', postalcode: '84101' });
    expect(placeQuery('Fort Worth')).toEqual({ q: 'Fort Worth' });
    expect(placeQuery('Laredo, XX')).toEqual({ q: 'Laredo, XX' });
  });

  it('falls back to free text when the structured search finds nothing', async () => {
    const urls: string[] = [];
    const fetcher = (async (url: string) => {
      urls.push(url);
      if (url.includes('nominatim')) return json(url.includes('city=') ? [] : [{ lat: '39.73', lon: '-104.83' }]);
      return json({ code: 'Ok', routes: [{ distance: 10 * 1609.344 }] });
    }) as unknown as typeof fetch;
    expect(await new MilesService(fetcher).miles('Denvr, CO', 'Aurora, CO')).toMatchObject({ miles: 10 });
    expect(urls.some((u) => u.includes('q=Denvr%2C+Colorado'))).toBe(true);
  });

  it('routes between two places and remembers the lane', async () => {
    const calls: string[] = [];
    const fetcher = (async (url: string) => {
      calls.push(url);
      if (url.includes('nominatim')) return json([url.includes('Dallas') || url.includes('dallas') ? { lat: '32.78', lon: '-96.80' } : { lat: '33.75', lon: '-84.39' }]);
      return json({ code: 'Ok', routes: [{ distance: 781 * 1609.344 }] });
    }) as unknown as typeof fetch;
    const s = new MilesService(fetcher);
    expect(await s.miles('Dallas, TX', 'Atlanta, GA')).toMatchObject({ miles: 781, estimate: false });
    const n = calls.length;
    expect(await s.miles('DALLAS TX', 'atlanta, ga')).toMatchObject({ miles: 781 });
    expect(calls.length).toBe(n);
  });

  it('estimates from the straight line when routing is down', async () => {
    const fetcher = (async (url: string) => (url.includes('nominatim')
      ? json([url.toLowerCase().includes('a+city') ? { lat: '32.78', lon: '-96.80' } : { lat: '33.75', lon: '-84.39' }])
      : new Response('', { status: 503 }))) as unknown as typeof fetch;
    const r = await new MilesService(fetcher).miles('A city', 'B town');
    expect(r?.estimate).toBe(true);
    expect(r!.miles).toBe(Math.round(straightMiles({ lat: 32.78, lon: -96.8 }, { lat: 33.75, lon: -84.39 }) * 1.2));
  });

  it('returns null for a place that is not on the map, and 0 for the same place', async () => {
    const fetcher = (async () => json([])) as unknown as typeof fetch;
    expect(await new MilesService(fetcher).miles('Nowhere', 'Atlanta, GA')).toBeNull();
    expect(await new MilesService(fetcher).miles('Atlanta, GA', 'atlanta ga')).toMatchObject({ miles: 0 });
  });
});

describe('Lanes for the map', () => {
  it('gives both ends, the road line, miles and truck-like driving hours', async () => {
    const fetcher = (async (url: string) => json({
      code: 'Ok', routes: [{ distance: 783 * 1609.344, duration: 14 * 3600, geometry: { coordinates: [[-96.8, 32.78], [-90.1, 32.3], [-84.39, 33.75]] } }],
    })) as unknown as typeof fetch;
    const r = (await new MilesService(fetcher).lane('Dallas, TX', 'Atlanta, GA'))!;
    expect(r.miles).toBe(783);
    expect(r.line).toHaveLength(3);
    expect(r.hours).toBeCloseTo(16.1, 1); // the car router's 14 h, +15% for a truck
    expect(r.truck).toBe(false);
    expect(r.a[1]).toBeCloseTo(32.78, 1);
  });

  it('puts only real places on the board map', async () => {
    const fetcher = (async () => json([{ lat: '35.1', lon: '-98.4' }])) as unknown as typeof fetch;
    const pts = await new MilesService(fetcher).points(['Dallas, TX', 'Nowhere, ZZ']);
    expect(pts['Dallas, TX']).not.toBeNull();
    expect(pts['Nowhere, ZZ']).toBeNull();
  });
});
