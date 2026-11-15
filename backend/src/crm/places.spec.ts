import { describe, expect, it } from 'vitest';
import { PlacesService, splitQuery } from './places.js';

const places = new PlacesService();

describe('US place suggestions', () => {
  it('reads what is typed as city and state', () => {
    expect(splitQuery('Santa Monica, CA')).toEqual({ city: 'santa monica', state: 'CA' });
    expect(splitQuery('santa monica ca')).toEqual({ city: 'santa monica', state: 'CA' });
    expect(splitQuery('Dallas, t')).toEqual({ city: 'dallas', state: 'T' });
    expect(splitQuery('St. Louis')).toEqual({ city: 'saint louis', state: '' });
    expect(splitQuery('Reno')).toEqual({ city: 'reno', state: '' });
  });

  it('suggests cities that start with the typed text, largest first', () => {
    const hits = places.suggest('santa mo').map((p) => p.label);
    expect(hits[0]).toBe('Santa Monica, CA');
    expect(places.suggest('portland')[0].label).toBe('Portland, OR');
    expect(places.suggest('portland, m')[0].label).toBe('Portland, ME');
    expect(places.suggest('new york')[0].label).toBe('New York, NY');
    expect(places.suggest('s')).toEqual([]);
  });

  it('knows the coordinates of an exact City, ST', () => {
    const p = places.find('Dallas, TX')!;
    expect(p.lat).toBeCloseTo(32.78, 1);
    expect(places.find('Aurora, CO')!.lon).toBeLessThan(-104);
    expect(places.find('Dallas')).toBeNull();
    expect(places.find('Nowhereville, TX')).toBeNull();
  });
});

describe('US place suggestions without a comma', () => {
  it('prefers the whole text as a city name over a trailing state code', () => {
    expect(places.suggest('santa monica ca')[0].label).toBe('Santa Monica, CA');
    expect(places.suggest('dallas tx')[0].label).toBe('Dallas, TX');
    expect(places.suggest('st louis')[0].label).toMatch(/^Saint Louis|^St\. Louis/);
  });
});
