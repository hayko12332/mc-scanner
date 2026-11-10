import { describe, expect, it } from 'vitest';
import { ExportStore, safeName } from './export.store.js';

describe('export store', () => {
  it('accepts only the export formats', () => {
    expect(safeName('new-mc-leads_2026-11-08_to_2026-11-10.xlsx')).toBe('new-mc-leads_2026-11-08_to_2026-11-10.xlsx');
    expect(safeName('a b.csv')).toBe('a_b.csv');
    expect(safeName('page.html')).toBeNull();
    expect(safeName('.vcf')).toBeNull();
    expect(safeName('../../x.vcf')).toBe('.._.._x.vcf');
  });

  it('serves a file until it expires', () => {
    let t = 0;
    const store = new ExportStore(() => t);
    const id = store.put('leads.csv', Buffer.from('MC,USDOT'));
    expect(store.get(id)?.type).toContain('text/csv');
    expect(store.get(id)?.data.toString()).toBe('MC,USDOT');
    t = 11 * 60_000;
    expect(store.get(id)).toBeNull();
    expect(store.get('nope')).toBeNull();
  });
});
