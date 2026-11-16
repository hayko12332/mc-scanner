import { describe, expect, it } from 'vitest';
import { PlacesService, splitQuery } from './places.js';

const places = new PlacesService();

describe('US place suggestions', () => {
  it('reads what is typed as city and state', () => {
    expect(splitQuery('Santa Monica, CA')).toEqual({ city: 'santa monica', states: ['CA'] });
    expect(splitQuery('santa monica ca')).toEqual({ city: 'santa monica', states: ['CA'] });
    expect(splitQuery('Dallas, t').states.sort()).toEqual(['TN', 'TX']);
    expect(splitQuery('St. Louis')).toEqual({ city: 'saint louis', states: [] });
    expect(splitQuery('Reno')).toEqual({ city: 'reno', states: [] });
    expect(splitQuery('Dallas, xq').states).toEqual(['-']);
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

describe('US place suggestions with state names', () => {
  it('reads full and half-typed state names', () => {
    expect(splitQuery('Dallas, Texas')).toEqual({ city: 'dallas', states: ['TX'] });
    expect(splitQuery('Dallas, tex')).toEqual({ city: 'dallas', states: ['TX'] });
    expect(splitQuery('dallas texas')).toEqual({ city: 'dallas', states: ['TX'] });
    expect(splitQuery('Kansas City Missouri')).toEqual({ city: 'kansas city', states: ['MO'] });
    expect(splitQuery('Albany, new').states.sort()).toEqual(['NH', 'NJ', 'NM', 'NY']);
    expect(splitQuery('Charleston West Virginia')).toEqual({ city: 'charleston', states: ['WV'] });
  });

  it('suggests and finds places typed with a state name', () => {
    expect(places.suggest('Dallas, Texas')[0].label).toBe('Dallas, TX');
    expect(places.suggest('portland maine')[0].label).toBe('Portland, ME');
    expect(places.suggest('Albany, new y')[0].label).toBe('Albany, NY');
    expect(places.find('Dallas, Texas')!.lat).toBeCloseTo(32.78, 1);
  });

  it('gives the largest cities of a state typed alone', () => {
    const ca = places.suggest('California').map((p) => p.label);
    expect(ca[0]).toBe('Los Angeles, CA');
    expect(ca).not.toContain('California, MD');
    expect(places.suggest('texas')[0].label).toBe('Houston, TX');
    expect(places.suggest('new york')[0].label).toBe('New York, NY');
  });
});
