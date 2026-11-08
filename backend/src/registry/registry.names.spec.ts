import { describe, expect, it } from 'vitest';
import { normalizeName, searchPrefix } from './registry.names.js';

describe('registry names', () => {
  it('strips the legal suffix for the search prefix', () => {
    expect(searchPrefix('MSQ SOLUTIONS INC')).toBe('MSQ SOLUTIONS');
    expect(searchPrefix('Oasis Freight, L.L.C.')).toBe('OASIS FREIGHT');
    expect(searchPrefix('H&B EXPRESS LLC')).toBe('H&B EXPRESS');
    expect(searchPrefix('J.B. HUNT TRANSPORT, INC.')).toBe('J.B. HUNT TRANSPORT');
  });

  it('keeps short names whole and drops LIKE wildcards', () => {
    expect(searchPrefix('AB LLC')).toBe('AB LLC');
    expect(searchPrefix('100% FREIGHT_CO LLC')).toBe('100 FREIGHT CO');
  });

  it('compares names without punctuation or case', () => {
    expect(normalizeName('Acme, Inc.')).toBe(normalizeName('ACME INC'));
    expect(normalizeName('H&B Express LLC')).toBe('H&B EXPRESS LLC');
  });
});
