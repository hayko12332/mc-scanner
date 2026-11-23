import { cityPage, companyPage, directoryPage, statePage } from './companies.pages.js';
import { companiesStore } from './companies.store.js';
import { FEATURES, featurePage } from './features.js';
import { SITE } from './layout.js';

// Which server-rendered public page answers a path: feature pages, the company directory and company pages,
// and the sitemaps. Anything else falls through to the app.

export interface SiteResponse { status: number; type: 'html' | 'xml'; body: string; redirect?: string; maxAge?: number }

const SITEMAP_SIZE = 40_000;
/** Pages that are not part of the company directory (the app's search pages and the feature pages). */
const STATIC_PAGES: [string, string, number][] = [
  ['/', 'weekly', 1.0], ['/new-mc-leads', 'daily', 0.9], ['/mc-number-lookup', 'weekly', 0.9], ['/mc-scanner', 'weekly', 0.7],
  ...Object.keys(FEATURES).map((p): [string, string, number] => [p, 'monthly', 0.8]),
  ['/carriers', 'weekly', 0.7], ['/privacy.html', 'yearly', 0.2], ['/terms.html', 'yearly', 0.2],
];
const xml = (body: string, maxAge = 3600): SiteResponse => ({ status: 200, type: 'xml', body: `<?xml version="1.0" encoding="UTF-8"?>\n${body}`, maxAge });
const today = () => new Date().toISOString().slice(0, 10);
const cache = new Map<string, { at: number; value: SiteResponse }>();
async function cached(key: string, ms: number, make: () => Promise<SiteResponse>): Promise<SiteResponse> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ms) return hit.value;
  const value = await make();
  // An empty answer (the company copy is still loading) is not kept.
  if (value.status === 200 && value.body.length > 400) cache.set(key, { at: Date.now(), value });
  return value;
}
const pageNo = (q: Record<string, unknown>) => { const n = parseInt(String(q.page ?? '1'), 10); return Number.isFinite(n) && n >= 1 && n <= 10_000 ? n : 1; };

export async function sitePage(path: string, query: Record<string, unknown>): Promise<SiteResponse | null> {
  const f = featurePage(path);
  if (f) return { status: 200, type: 'html', body: f, maxAge: 3600 };

  let m = /^\/mc\/(?:mc-?)?(\d{1,8})$/i.exec(path);
  if (m) {
    const mc = parseInt(m[1], 10);
    if (`/mc/${mc}` !== path) return { status: 301, type: 'html', body: '', redirect: `/mc/${mc}` };
    const r = await companyPage(mc);
    return { status: r.status, type: 'html', body: r.html, maxAge: r.status === 200 ? 86_400 : 600 };
  }
  m = /^\/(?:usdot|dot)\/(\d{1,9})$/i.exec(path);
  if (m) {
    const mc = await companiesStore.mcOfDot(parseInt(m[1], 10));
    return mc ? { status: 301, type: 'html', body: '', redirect: `/mc/${mc}` } : null;
  }
  if (path === '/carriers') { const r = await directoryPage(); return { status: r.status, type: 'html', body: r.html, maxAge: 86_400 }; }
  m = /^\/carriers\/([a-z]{2})$/.exec(path);
  if (m) { const r = await statePage(m[1], pageNo(query)); return r && { status: r.status, type: 'html', body: r.html, maxAge: 86_400 }; }
  m = /^\/carriers\/([a-z]{2})\/([a-z0-9-]{1,80})$/.exec(path);
  if (m) { const r = await cityPage(m[1], m[2], pageNo(query)); return r && { status: r.status, type: 'html', body: r.html, maxAge: 86_400 }; }

  if (path === '/sitemap.xml') {
    return cached('index', 3600_000, async () => {
      const files = Math.ceil((await companiesStore.count()) / SITEMAP_SIZE);
      const all = ['/sitemap-pages.xml', ...(files ? ['/sitemap-cities.xml'] : []), ...Array.from({ length: files }, (_, i) => `/sitemap-companies-${i + 1}.xml`)];
      return xml(`<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${all.map((p) => `  <sitemap><loc>${SITE}${p}</loc><lastmod>${today()}</lastmod></sitemap>`).join('\n')}\n</sitemapindex>`);
    });
  }
  if (path === '/sitemap-pages.xml') {
    return xml(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${STATIC_PAGES.map(([p, freq, pr]) => `  <url><loc>${SITE}${p}</loc><lastmod>${today()}</lastmod><changefreq>${freq}</changefreq><priority>${pr.toFixed(1)}</priority></url>`).join('\n')}\n</urlset>`);
  }
  if (path === '/sitemap-cities.xml') {
    return cached('cities', 24 * 3600_000, async () => {
      const [states, cities] = await Promise.all([companiesStore.states(), companiesStore.allCities()]);
      const urls = [...states.map((s) => `/carriers/${s.state.toLowerCase()}`), ...cities.map((c) => `/carriers/${c.state.toLowerCase()}/${c.slug}`)].slice(0, 50_000);
      return xml(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((p) => `  <url><loc>${SITE}${p}</loc></url>`).join('\n')}\n</urlset>`, 86_400);
    });
  }
  m = /^\/sitemap-companies-(\d{1,3})\.xml$/.exec(path);
  if (m) {
    const i = parseInt(m[1], 10) - 1;
    // Not kept in memory (40k addresses each): the database answers these in well under a second.
    const mcs = await companiesStore.sitemapChunk(i, SITEMAP_SIZE);
    if (!mcs.length) return { status: 404, type: 'xml', body: '' };
    return xml(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${mcs.map((mc) => `  <url><loc>${SITE}/mc/${mc}</loc></url>`).join('\n')}\n</urlset>`, 86_400);
  }
  return null;
}
