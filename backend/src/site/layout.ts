// The shared frame of the server-rendered public pages (company pages, state and city lists, feature pages):
// light, fast, readable without JavaScript, with the same brand as the app.

export const SITE = 'https://haulpanel.com';

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const STATES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine',
  MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', PR: 'Puerto Rico', GU: 'Guam', VI: 'U.S. Virgin Islands', AS: 'American Samoa', MP: 'Northern Mariana Islands',
  AB: 'Alberta', BC: 'British Columbia', MB: 'Manitoba', NB: 'New Brunswick', NL: 'Newfoundland and Labrador', NS: 'Nova Scotia', ON: 'Ontario', PE: 'Prince Edward Island',
  QC: 'Quebec', SK: 'Saskatchewan',
};
export const stateName = (st: string) => STATES[st] ?? st;

/** The feature pages, for the menu, the footer and the sitemap. */
export const FEATURE_LINKS: [string, string][] = [
  ['/truck-dispatch-software', 'Truck dispatch software'],
  ['/freight-broker-tms', 'Freight broker TMS'],
  ['/rate-confirmation-ai', 'Rate confirmation AI'],
  ['/bol-pod-software', 'BOL & POD software'],
];

const CSS = `
:root{--bg:#fff;--soft:#f6f8fc;--text:#0f172a;--muted:#5b6678;--line:#e3e8f0;--accent:#2563eb;--accent-soft:#eef3ff;--ok:#15803d;--bad:#b91c1c}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
html{color-scheme:light}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.6 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
.wrap{max-width:1120px;margin:0 auto;padding:0 20px}
.top{position:sticky;top:0;z-index:5;background:color-mix(in srgb,var(--bg) 92%,transparent);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
.top .wrap{display:flex;align-items:center;gap:22px;height:62px}
.brand{display:flex;align-items:center;gap:9px;font-weight:800;font-size:18px;color:var(--text)!important;text-decoration:none!important}
.brand img{border-radius:8px}
.nav{display:flex;gap:18px;margin-left:8px;font-size:14.5px}.nav a{color:var(--muted)}.nav a:hover{color:var(--text);text-decoration:none}
.cta{margin-left:auto;display:flex;gap:10px;align-items:center}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:42px;padding:0 18px;border-radius:10px;font-weight:700;font-size:15px;border:1px solid var(--line);color:var(--text);background:var(--bg);text-decoration:none!important}
.btn.primary{background:var(--accent);border-color:var(--accent);color:#fff;box-shadow:0 6px 16px rgba(37,99,235,.22)}
.btn.big{height:50px;padding:0 24px;font-size:16px}
.crumbs{font-size:13.5px;color:var(--muted);margin:22px 0 6px}.crumbs a{color:var(--muted)}
h1{font-size:40px;line-height:1.12;letter-spacing:-.03em;margin:8px 0 12px;text-wrap:balance}
h2{font-size:26px;line-height:1.2;letter-spacing:-.02em;margin:0 0 12px;text-wrap:balance}
h3{font-size:17px;margin:0 0 6px}
p{margin:0 0 14px}.muted{color:var(--muted)}.lead{font-size:19px;color:var(--muted);max-width:640px}
.hero{display:grid;grid-template-columns:1fr 1.05fr;gap:48px;align-items:center;padding:40px 0 56px}
.kicker{display:inline-flex;align-items:center;gap:7px;padding:6px 12px;border-radius:99px;background:var(--accent-soft);color:var(--accent);font-weight:700;font-size:13px}
.shot{border-radius:14px;overflow:hidden;border:1px solid var(--line);box-shadow:0 30px 70px rgba(15,23,42,.16)}.shot img{display:block;width:100%;height:auto}
.actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:22px}
.note{font-size:13.5px;color:var(--muted);margin-top:12px}
.band{background:var(--soft);border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:56px 0}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}.grid2{display:grid;grid-template-columns:repeat(2,1fr);gap:18px}
.card{background:var(--bg);border:1px solid var(--line);border-radius:14px;padding:22px}
.card .ico{display:grid;place-items:center;width:38px;height:38px;border-radius:10px;background:var(--accent-soft);color:var(--accent);font-size:18px;margin-bottom:12px}
.card ul{margin:8px 0 0;padding-left:18px;color:var(--muted)}.card li{margin:4px 0}
section.pad{padding:56px 0}
.steps{counter-reset:s;display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin:0;padding:0;list-style:none}
.steps li{counter-increment:s;padding:22px;border:1px solid var(--line);border-radius:14px}
.steps li::before{content:counter(s);display:grid;place-items:center;width:30px;height:30px;border-radius:50%;background:var(--accent);color:#fff;font-weight:800;margin-bottom:10px}
details{border:1px solid var(--line);border-radius:12px;padding:14px 18px;margin:10px 0;background:var(--bg)}
summary{cursor:pointer;font-weight:700}details p{margin:10px 0 0;color:var(--muted)}
.final{text-align:center;padding:64px 0}.final .actions{justify-content:center}
.facts{display:grid;grid-template-columns:repeat(2,1fr);gap:0;border:1px solid var(--line);border-radius:14px;overflow:hidden;margin:18px 0 24px}
.facts div{padding:14px 18px;border-bottom:1px solid var(--line)}.facts div:nth-child(odd){border-right:1px solid var(--line)}
.facts dt{font-size:12.5px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}.facts dd{margin:3px 0 0;font-size:16px;font-weight:600}
.pill{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:99px;font-size:13px;font-weight:700;background:#dcfce7;color:#15803d}
.box{border:1px solid var(--line);border-radius:14px;padding:22px;background:var(--soft);margin:0 0 24px}
.cols{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:32px;align-items:start;padding-bottom:48px}
.list{list-style:none;margin:0;padding:0}.list li{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid var(--line)}
.list li small{color:var(--muted);white-space:nowrap}
.cityl{columns:3;column-gap:28px;list-style:none;padding:0;margin:0}.cityl li{break-inside:avoid;padding:4px 0}.cityl small{color:var(--muted)}
.pager{display:flex;gap:10px;justify-content:space-between;margin:20px 0}
.foot{border-top:1px solid var(--line);padding:40px 0;font-size:14px;color:var(--muted)}
.foot .cols4{display:grid;grid-template-columns:repeat(4,1fr);gap:20px;margin-bottom:24px}.foot b{color:var(--text);display:block;margin-bottom:8px}
.foot a{display:block;color:var(--muted);padding:2px 0}
@media (max-width:900px){.hero,.cols{grid-template-columns:1fr}.grid3,.steps{grid-template-columns:1fr}.grid2{grid-template-columns:1fr}.nav{display:none}h1{font-size:32px}.cityl{columns:2}.foot .cols4{grid-template-columns:1fr 1fr}.facts{grid-template-columns:1fr}.facts div:nth-child(odd){border-right:0}}
@media (max-width:480px){.cta .btn:not(.primary){display:none}.cityl{columns:1}}
`;

export interface PageOpts {
  path: string;
  title: string;
  description: string;
  body: string;
  /** schema.org objects for this page. */
  jsonLd?: object[];
  noindex?: boolean;
  /** Full URL of the page's main picture (search thumbnail, link previews); the HaulPanel cover by default. */
  image?: string;
  imageSize?: [number, number];
}

export const COVER = { url: `${SITE}/haulpanel-cover.jpg`, size: [1600, 900] as [number, number] };

/** A full HTML page in the site frame. */
export function page(o: PageOpts): string {
  const url = SITE + o.path;
  const image = o.image ?? COVER.url;
  const [w, h] = o.image ? (o.imageSize ?? [0, 0]) : COVER.size;
  // The page's preferred picture for search results.
  const pageLd = o.noindex ? [] : [{ '@context': 'https://schema.org', '@type': 'WebPage', url, name: o.title, image,
    primaryImageOfPage: { '@type': 'ImageObject', url: image, ...(w ? { width: w, height: h } : {}) } }];
  const ld = [...pageLd, ...(o.jsonLd ?? [])].map((x) => `<script type="application/ld+json">${JSON.stringify(x).replace(/</g, '\\u003c')}</script>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(o.title)}</title><meta name="description" content="${esc(o.description)}">
${o.noindex ? '<meta name="robots" content="noindex">' : `<meta name="robots" content="index, follow, max-image-preview:large"><link rel="canonical" href="${esc(url)}">`}
<meta property="og:type" content="website"><meta property="og:site_name" content="HaulPanel"><meta property="og:url" content="${esc(url)}">
<meta property="og:title" content="${esc(o.title)}"><meta property="og:description" content="${esc(o.description)}"><meta property="og:image" content="${esc(image)}">${w ? `<meta property="og:image:width" content="${w}"><meta property="og:image:height" content="${h}">` : ''}
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${esc(image)}">
<link rel="icon" href="/favicon.ico" sizes="48x48"><link rel="icon" type="image/svg+xml" href="/logo.svg"><link rel="apple-touch-icon" href="/logo.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>${CSS}</style>${ld}
</head><body>
<header class="top"><div class="wrap">
<a class="brand" href="/"><img src="/logo.svg" alt="" width="28" height="28">HaulPanel</a>
<nav class="nav"><a href="/truck-dispatch-software">Dispatchers</a><a href="/freight-broker-tms">Brokers</a><a href="/mc-number-lookup">MC lookup</a><a href="/new-mc-leads">New MC leads</a><a href="/free-trucking-tools">Free tools</a></nav>
<div class="cta"><a class="btn" href="/#/crm?login">Log in</a><a class="btn primary" href="/#/crm?signup">Start free</a></div>
</div></header>
<main>${o.body}</main>
<footer class="foot"><div class="wrap">
<div class="cols4">
<div><b>Product</b>${FEATURE_LINKS.map(([href, label]) => `<a href="${href}">${label}</a>`).join('')}<a href="/">HaulPanel TMS</a></div>
<div><b>Tools</b><a href="/mc-number-lookup">MC number lookup</a><a href="/new-mc-leads">New MC leads</a><a href="/mc-scanner">MC scanner</a><a href="/carriers">Carrier directory</a><a href="/free-trucking-tools">Free trucking tools</a><a href="/rate-per-mile-calculator">Rate per mile calculator</a><a href="/freight-invoice-template">Freight invoice template</a><a href="/how-to-become-a-truck-dispatcher">How to become a dispatcher</a></div>
<div><b>Carriers by state</b>${['TX', 'CA', 'FL', 'IL', 'GA', 'NJ', 'NY', 'PA'].map((s) => `<a href="/carriers/${s.toLowerCase()}">${stateName(s)}</a>`).join('')}</div>
<div><b>Company</b><a href="mailto:support@haulpanel.com">support@haulpanel.com</a><a href="/privacy.html">Privacy Policy</a><a href="/terms.html">Terms of Service</a><a href="https://t.me/MCUSDOTScannerbot">Telegram bot</a></div>
</div>
<div>© ${new Date().getFullYear()} HaulPanel. Company data from FMCSA public records; HaulPanel is not affiliated with FMCSA or USDOT.</div>
</div></footer>
</body></html>`;
}
