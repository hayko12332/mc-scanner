import { describe, expect, it } from 'vitest';
import { censusToCompanies } from './companies.sync.js';
import { slug, titleCase } from './companies.store.js';
import { FEATURES, featurePage } from './features.js';
import { kindsOf } from './companies.pages.js';
import { sitePage } from './router.js';

describe('public site', () => {
  it('turns a census record into one company per MC, without contact details', () => {
    const rows = censusToCompanies({
      dot_number: '3550347', legal_name: 'UZLAND  LLC', dba_name: '', phy_city: 'COLUMBUS', phy_state: 'oh', power_units: '12', total_drivers: '14',
      carship: 'C,B', carrier_operation: 'A', add_date: '20210115', mcs150_date: '20250301', docket1prefix: 'MC', docket1: '1188808',
      docket2prefix: 'FF', docket2: '55', crgo_genfreight: 'X', crgo_coldfood: 'X', phone: '5551234567', email_address: 'x@y.com',
    });
    expect(rows).toEqual([{
      mc: 1188808, dot: 3550347, name: 'UZLAND LLC', dba: '', city: 'COLUMBUS', state: 'OH', kinds: 'C,B', operation: 'A', powerUnits: 12, drivers: 14,
      cargo: ['General Freight', 'Refrigerated Food'], addedOn: '2021-01-15', mcs150On: '2025-03-01',
    }]);
    expect(JSON.stringify(rows)).not.toContain('555');
    expect(kindsOf(rows[0])).toEqual(['Carrier', 'Broker']);
    expect(censusToCompanies({ dot_number: '1', legal_name: 'NO MC', docket1prefix: 'MX', docket1: '9' })).toEqual([]);
  });

  it('makes city slugs and readable names', () => {
    expect(slug('SALT LAKE CITY')).toBe('salt-lake-city');
    expect(slug("COEUR D'ALENE")).toBe('coeur-d-alene');
    expect(titleCase('SALT LAKE CITY')).toBe('Salt Lake City');
  });

  it('renders every feature page with its title, FAQ schema and a sign-up link', async () => {
    for (const path of Object.keys(FEATURES)) {
      const html = featurePage(path)!;
      expect(html).toContain(`<title>${FEATURES[path].title.replace(/&/g, '&amp;')}</title>`);
      expect(html).toContain('"@type":"FAQPage"');
      expect(html).toContain('href="/#/crm?signup"');
      expect(html).toContain(`<link rel="canonical" href="https://haulpanel.com${path}">`);
      expect((await sitePage(path, {}))?.status).toBe(200);
    }
    expect(await sitePage('/somewhere-else', {})).toBeNull();
    expect(await sitePage('/mc/MC-0123', {})).toMatchObject({ status: 301, redirect: '/mc/123' });
  });

  it('lists the feature pages in the pages sitemap', async () => {
    const r = await sitePage('/sitemap-pages.xml', {});
    expect(r?.type).toBe('xml');
    for (const p of Object.keys(FEATURES)) expect(r?.body).toContain(`<loc>https://haulpanel.com${p}</loc>`);
    expect(r?.body).toContain('<loc>https://haulpanel.com/mc-number-lookup</loc>');
  });
});
