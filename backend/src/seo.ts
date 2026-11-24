import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Search pages: the app is one page with #/routes, which search engines treat as a single URL. These real paths
// serve the same app with their own title, description, canonical link and readable text, so each can rank for
// its own searches ("new MC leads", "MC number lookup"...). The app opens the matching tool on them.

export interface SeoPage { title: string; description: string; h1: string; intro: string; points: string[] }

/** The picture search results and link previews show for the tool pages. */
export const SEO_IMAGE = { path: '/haulpanel-cover.jpg', width: 1600, height: 900 };

const SITE = 'https://haulpanel.com';

export const SEO_PAGES: Record<string, SeoPage> = {
  '/new-mc-leads': {
    title: 'New MC Leads Daily — Carriers with Phone & Email | HaulPanel',
    description: 'New MC leads every day: carriers and freight brokers that just got FMCSA authority, with phone and email. Export to Excel, Sheets or CSV. Free.',
    h1: 'New MC leads — carriers that just got their authority',
    intro: 'Every day 150+ carriers get their FMCSA operating authority, and most of them don’t have a dispatcher yet. HaulPanel lists them with phone and email so you can call them first.',
    points: [
      'New MC numbers granted today, yesterday, or in the last 7, 14 or 30 days',
      'Phone and email for every carrier, authority verified live on SAFER',
      'New freight brokers too — switch between Carriers and Brokers',
      'Export to Excel, Google Sheets, CSV or your phone’s contacts',
    ],
  },
  '/mc-number-lookup': {
    title: 'MC Number Lookup — Check Any Carrier by MC or USDOT | HaulPanel',
    description: 'Free MC and USDOT lookup: authority, insurance history, live SAFER status, fleet, state registration and companies sharing the same phone or email.',
    h1: 'MC number & USDOT lookup',
    intro: 'Check any trucking company or freight broker before you work with it. Search by MC number, USDOT number, email or phone.',
    points: [
      'Operating authority status and history, verified live on SAFER',
      'Insurance on file: BIPD, cargo, bond — and policy history',
      'Fleet size, cargo types, state business registration, liens and courts',
      'Other companies using the same phone number or email',
    ],
  },
  '/mc-scanner': {
    title: 'MC Scanner — Authorized Carriers with Phone & Email | HaulPanel',
    description: 'Scan any MC number range and collect authorized carriers or brokers with phone and email, verified live on SAFER. Export to CSV or Excel. Free.',
    h1: 'MC scanner — authorized carriers with phone & email',
    intro: 'Pick a starting MC number and the scanner walks the range, keeping only companies with active authority, a phone and an email.',
    points: [
      'Carriers or freight brokers, active USDOT only',
      'Every company re-checked live on FMCSA SAFER',
      'Copy all phones or emails in one click',
      'Export to CSV, Excel or your phone’s contacts',
    ],
  },
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The app's index.html with a search page's own title, description, canonical URL and readable text. */
export function seoHtml(html: string, path: string, page: SeoPage): string {
  const url = SITE + path;
  const fallback = `<main class="boot-text" style="max-width: 760px; margin: 0 auto; padding: 24px 16px; font: 15px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif">
        <h1>${esc(page.h1)}</h1>
        <p>${esc(page.intro)}</p>
        <ul>${page.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
        <p>Part of <a href="${SITE}/">HaulPanel</a> — the AI TMS for truck dispatchers and freight brokers. Data: official FMCSA open data and SAFER.</p>
        <p>More tools: ${Object.entries(SEO_PAGES).filter(([p]) => p !== path).map(([p, x]) => `<a href="${SITE}${p}">${esc(x.h1.split(' — ')[0])}</a>`).join(' · ')} · <a href="${SITE}/">HaulPanel TMS</a></p>
      </main>`;
  const img = SITE + SEO_IMAGE.path;
  const ld = JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebPage', url, name: page.title,
    primaryImageOfPage: { '@type': 'ImageObject', url: img, width: SEO_IMAGE.width, height: SEO_IMAGE.height }, image: img, isPartOf: { '@id': `${SITE}/#site` } }).replace(/</g, '\\u003c');
  return html
    .replace(/<script type="application\/ld\+json" id="ld-page">[\s\S]*?<\/script>/, `<script type="application/ld+json" id="ld-page">${ld}</script>`)
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(page.title)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(")/, `$1${esc(page.description)}$2`)
    .replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${url}$2`)
    .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${url}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${esc(page.title)}$2`)
    .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${esc(page.description)}$2`)
    .replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${esc(page.title)}$2`)
    .replace(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${esc(page.description)}$2`)
    .replace(/<main(?: class="[^"]*")? style="[^"]*">[\s\S]*?<\/main>/, fallback);
}

const indexPath = fileURLToPath(new URL('../../frontend/dist/index.html', import.meta.url));
let cached: { mtime: number; html: string } | null = null;

/** The built index.html, re-read when a new build replaces it. */
export function indexHtml(): string | null {
  try {
    const mtime = statSync(indexPath).mtimeMs;
    if (!cached || cached.mtime !== mtime) cached = { mtime, html: readFileSync(indexPath, 'utf8') };
    return cached.html;
  } catch {
    return null;
  }
}
