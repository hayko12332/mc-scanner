import { describe, expect, it } from 'vitest';
import { censusToCompanies } from './companies.sync.js';
import { slug, titleCase } from './companies.store.js';
import { FEATURES, featurePage } from './features.js';
import { kindsOf } from './companies.pages.js';
import { sitePage } from './router.js';
import { indexNowBody, INDEXNOW_KEY } from './indexnow.service.js';
import { existsSync, readFileSync } from 'node:fs';

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

  it('sends IndexNow with our host and the key file that is on the site', () => {
    expect(indexNowBody(['/mc/109', '/freight-broker-tms'])).toEqual({
      host: 'haulpanel.com', key: INDEXNOW_KEY, keyLocation: `https://haulpanel.com/${INDEXNOW_KEY}.txt`,
      urlList: ['https://haulpanel.com/mc/109', 'https://haulpanel.com/freight-broker-tms'],
    });
    const file = new URL(`../../../frontend/public/${INDEXNOW_KEY}.txt`, import.meta.url);
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe(INDEXNOW_KEY);
  });

  it('writes each place page from its own numbers, counting a company with two MCs once', async () => {
    const { placeSummary } = await import('./companies.pages.js');
    const co = (mc: number, dot: number, nm: string, trucks: number) => ({ mc, dot, name: nm, dba: '', city: 'DALLAS', state: 'TX', kinds: 'C', operation: 'A', powerUnits: trucks, drivers: trucks, cargo: [], addedOn: '2026-10-01', mcs150On: null });
    const s = placeSummary('Dallas, TX', { total: 10, carriers: 8, brokers: 2, trucks: 40, drivers: 45, solo: 5, small: 4, mid: 1, large: 0, newYear: 3, interstate: 9,
      cargo: [{ name: 'General Freight', n: 8 }], newest: [co(5, 50, 'NEW ROAD LLC', 1)] }, [co(1, 10, 'BIG FLEET INC', 20), co(2, 10, 'BIG FLEET INC', 20), co(3, 30, 'MID TRUCKING LLC', 9)], '');
    expect(s.lead).toContain('10 trucking companies are based in Dallas, TX');
    expect(s.lead).toContain('50% are one-truck owner-operators');
    expect(s.lead).toContain('Big Fleet INC (20 trucks), followed by Mid Trucking LLC (9 trucks).');
    expect(s.description).toMatch(/^List of 10 trucking companies in Dallas, TX: 8 carriers and 2 freight brokers running 40 trucks\. 3 new this year\./);
    expect(s.more).toContain('href="/mc/5"');
    expect(s.faqLd.mainEntity[0].name).toBe('How many trucking companies are in Dallas, TX?');
  });

  it('serves every free tool and guide with its own title, FAQ schema and working script, and lists them in the sitemap', async () => {
    const { FREE, freePage } = await import('./free.js');
    const { sitePage } = await import('./router.js');
    const { Script } = await import('node:vm');
    for (const p of Object.keys(FREE)) {
      const html = freePage(p)!;
      expect(html).toContain(`<link rel="canonical" href="https://haulpanel.com${p}">`);
      expect(html).toContain('"@type":"FAQPage"');
      const js = /<script>([\s\S]*?)<\/script>/.exec(html.slice(html.indexOf('<main>')))?.[1];
      if (FREE[p].kind === 'tool') expect(() => new Script(js!)).not.toThrow(); // the page's own code at least parses
    }
    expect(freePage('/free-trucking-tools')).toContain('href="/rate-per-mile-calculator"');
    // The server hands these addresses to the site pages (a missing one would answer 404).
    const { SITE_PATHS } = await import('./router.js');
    for (const p of ['/free-trucking-tools', '/truck-dispatch-software', ...Object.keys(FREE)]) expect(SITE_PATHS.has(p)).toBe(true);
    const map = await sitePage('/sitemap-pages.xml', {});
    for (const p of ['/free-trucking-tools', ...Object.keys(FREE)]) expect(map!.body).toContain(`https://haulpanel.com${p}</loc>`);
  });
});
