import { describe, expect, it } from 'vitest';
import { parseLookupQuery } from './lookup.query.js';

describe('parseLookupQuery', () => {
  it('treats a bare number as MC or USDOT', () => {
    expect(parseLookupQuery('1650101')).toEqual({ kinds: ['mc', 'dot'], value: '1650101' });
    expect(parseLookupQuery(' 0042 ')).toEqual({ kinds: ['mc', 'dot'], value: '42' });
  });

  it('honours MC / USDOT prefixes', () => {
    expect(parseLookupQuery('MC-1650101')).toEqual({ kinds: ['mc'], value: '1650101' });
    expect(parseLookupQuery('mc 3')).toEqual({ kinds: ['mc'], value: '3' });
    expect(parseLookupQuery('USDOT 2952744')).toEqual({ kinds: ['dot'], value: '2952744' });
    expect(parseLookupQuery('DOT#2952744')).toEqual({ kinds: ['dot'], value: '2952744' });
  });

  it('recognizes phones in common formats', () => {
    for (const q of ['(614) 555-1234', '614-555-1234', '+1 614 555 1234', '6145551234']) {
      expect(parseLookupQuery(q)).toEqual({ kinds: ['phone'], value: '6145551234' });
    }
  });

  it('upper-cases emails for a case-insensitive match', () => {
    expect(parseLookupQuery(' Info@Example.com ')).toEqual({ kinds: ['email'], value: 'INFO@EXAMPLE.COM' });
  });

  it('respects an explicit type', () => {
    expect(parseLookupQuery('1650101', 'dot')).toEqual({ kinds: ['dot'], value: '1650101' });
    expect(parseLookupQuery('MC 5', 'dot')).toBeNull();
    expect(parseLookupQuery('12345', 'phone')).toBeNull();
    expect(parseLookupQuery('not an email', 'email')).toBeNull();
  });

  it('rejects text that is none of the supported kinds', () => {
    expect(parseLookupQuery('')).toBeNull();
    expect(parseLookupQuery('ACME TRUCKING')).toBeNull();
    expect(parseLookupQuery("1' OR '1'='1")).toBeNull();
    expect(parseLookupQuery('123456789')).toBeNull();
  });
});
