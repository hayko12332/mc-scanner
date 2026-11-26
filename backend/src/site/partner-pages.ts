import { esc, page, SITE } from './layout.js';
import { goHref, PARTNER_CATEGORIES, partner, PARTNERS, type PartnerCategory } from './partners.js';
import { COMPARISONS, PROFILES, type Comparison, type Profile } from './partner-profiles.js';

// A page for every recommended company (/trucking-services/<slug>) and comparison pages per category — facts from
// the companies' own sites, checked on the date shown, with sources. No invented ratings or reviews.

export const profilePath = (id: string) => `/trucking-services/${PROFILES[id]?.slug ?? id}`;
const checked = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const DISCLOSURE = 'Some links on this page are referral links: HaulPanel may earn a fee if you sign up, at no cost to you. It does not change what we write.';
/** Line icons (24px grid, currentColor) — the same set across the service pages. */
const SVG: Record<string, string> = {
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/>',
  shield: '<path d="M12 3 4 6v6c0 4.6 3.4 8.1 8 9 4.6-.9 8-4.4 8-9V6l-8-3z"/><path d="m9 12 2 2 4-4"/>',
  card: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 10h18M7 15h4"/>',
  chart: '<path d="M4 20V11M10 20V5M16 20v-6M3 20h18"/>',
  doc: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h4"/>',
  route: '<circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="6" r="2.2"/><path d="M8.2 18H15a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h6.8"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
};
export const icon = (name: string, size = 20) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SVG[name] ?? SVG.check}</svg>`;
/** An icon that fits what a feature is about. */
const iconFor = (h: string) => /fund|pay|fast|instant|money|advance|quick/i.test(h) ? 'bolt'
  : /recourse|guarantee|fraud|insur|liabil|protect|check|compliance|safety|hours/i.test(h) ? 'shield'
  : /fuel|card|bill/i.test(h) ? 'card'
  : /rate|price|discount|credit|cost|fee/i.test(h) ? 'chart'
  : /invoice|document|report|ifta|llc|ein|agreement|receipt|filing|operating|mileage/i.test(h) ? 'doc'
  : /route|gps|track|map|search|load|posting|dashcam|gateway/i.test(h) ? 'route'
  : /api|integrat|connect|app|tms|switch/i.test(h) ? 'link' : 'check';

export const SVC_CSS = `<style>
.svc-hero{position:relative;overflow:hidden;border-bottom:1px solid var(--line);background:radial-gradient(900px 380px at 85% -10%,#dbe7ff 0,transparent 60%),radial-gradient(700px 320px at -5% 110%,#eef2ff 0,transparent 60%),linear-gradient(180deg,#f8faff,#fff)}
.svc-hero::before{content:"";position:absolute;inset:0;background-image:linear-gradient(#e7edf7 1px,transparent 1px),linear-gradient(90deg,#e7edf7 1px,transparent 1px);background-size:44px 44px;mask-image:radial-gradient(ellipse at 70% 0,#000 0,transparent 70%);opacity:.55;pointer-events:none}
.svc-hero .wrap{position:relative}
.ph{display:grid;grid-template-columns:minmax(0,1fr) 380px;gap:48px;align-items:start;padding:6px 0 48px}
.ph-brand{display:flex;align-items:center;gap:12px;margin:10px 0 14px;flex-wrap:wrap}
.ph-logo{width:76px;height:76px;border-radius:20px;background:#fff;display:grid;place-items:center;box-shadow:0 0 0 1px var(--line),0 12px 30px rgba(15,23,42,.10)}
.ph-logo img{width:54px;height:54px;object-fit:contain;border-radius:10px}
.tag{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px;border-radius:99px;font-size:13px;font-weight:700;background:#fff;border:1px solid var(--line);color:var(--muted)}
.tag.acc{background:var(--accent-soft);border-color:#cfdcfb;color:var(--accent)}
.ph h1,.cmp-h h1{font-size:46px;line-height:1.06;letter-spacing:-.035em;margin:0 0 14px}
.ph .lead{font-size:18.5px;max-width:620px}
.trust{display:flex;flex-wrap:wrap;gap:8px 18px;margin-top:20px;font-size:13.5px;color:var(--muted)}.trust span{display:inline-flex;align-items:center;gap:6px}.trust svg{color:#16a34a}
.btn svg{flex:none}
.glance{border-radius:20px;background:#fff;padding:22px;box-shadow:0 0 0 1px var(--line),0 24px 50px rgba(15,23,42,.10);position:sticky;top:132px}
.glance-h{display:flex;align-items:center;gap:10px;padding-bottom:14px;margin-bottom:4px;border-bottom:1px solid var(--line)}
.glance-h img{width:34px;height:34px;border-radius:9px;box-shadow:0 0 0 1px var(--line)}.glance-h b{display:block;font-size:15px}.glance-h small{color:var(--muted);font-size:12.5px;text-transform:uppercase;letter-spacing:.06em;font-weight:700}
.glance dl{margin:0}.glance dl div{display:flex;justify-content:space-between;gap:16px;padding:11px 0;border-bottom:1px dashed #e6ebf3}.glance dl div:last-child{border:0}
.glance dt{color:var(--muted);font-size:14px;white-space:nowrap}.glance dd{margin:0;font-weight:700;font-size:14.5px;text-align:right}
.glance .btn{width:100%;margin-top:14px}.glance .note{text-align:center;margin:10px 0 0;font-size:12.5px}
.subnav{position:sticky;top:62px;z-index:4;background:rgba(255,255,255,.92);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
.subnav .wrap{display:flex;gap:4px;overflow-x:auto;scrollbar-width:none}.subnav .wrap::-webkit-scrollbar{display:none}
.subnav a{flex:none;padding:14px 12px;font-size:14px;font-weight:600;color:var(--muted);border-bottom:2px solid transparent}.subnav a:hover{color:var(--text);text-decoration:none;border-color:var(--accent)}
.sec{padding:56px 0 8px;scroll-margin-top:120px}.sec>h2,.sec-h h2{font-size:30px;margin:0 0 6px}
.eyebrow{display:block;font-size:12.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--accent);margin-bottom:8px}
.sec-sub{color:var(--muted);max-width:720px;margin:0 0 24px}
.feat{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.feat>div{position:relative;border:1px solid var(--line);border-radius:16px;padding:22px;background:#fff;transition:transform .15s,box-shadow .15s,border-color .15s}
.feat>div:hover{transform:translateY(-2px);box-shadow:0 14px 30px rgba(15,23,42,.08);border-color:#d6e0f0}
.feat i{display:grid;place-items:center;width:42px;height:42px;border-radius:12px;background:linear-gradient(135deg,#eef3ff,#e0e9ff);color:var(--accent);margin-bottom:14px}
.feat h3{font-size:16.5px;margin-bottom:6px}.feat p{margin:0;color:var(--muted);font-size:14.5px;line-height:1.6}
.plans{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px}
.plans>div{border:1px solid var(--line);border-radius:16px;padding:20px;background:#fff}
.plans small{display:block;font-size:12.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.plans strong{display:block;font-size:28px;letter-spacing:-.025em;margin:8px 0 10px;padding-bottom:12px;border-bottom:1px solid var(--line)}.plans p{margin:0;color:var(--muted);font-size:14px}
.pricing-note{display:flex;gap:12px;align-items:flex-start;background:var(--soft);border:1px solid var(--line);border-radius:14px;padding:16px 18px;margin:0 0 18px;color:var(--muted);max-width:860px}.pricing-note svg{color:var(--accent);margin-top:2px;flex:none}
.tl{list-style:none;margin:0;padding:0;display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:18px;counter-reset:s;position:relative}
.tl::before{content:"";position:absolute;left:18px;right:18px;top:18px;height:2px;background:linear-gradient(90deg,var(--accent),#c7d7fe)}
.tl li{counter-increment:s;position:relative}.tl li::before{content:counter(s);position:relative;display:grid;place-items:center;width:38px;height:38px;border-radius:50%;background:var(--accent);color:#fff;font-weight:800;box-shadow:0 0 0 6px #fff;margin-bottom:12px}
.tl li span{display:block;color:var(--text);font-size:15px;line-height:1.55}
.hpband{border-radius:22px;padding:30px 32px;background:radial-gradient(600px 240px at 100% 0,rgba(59,130,246,.35),transparent 60%),linear-gradient(135deg,#0b1224,#13224a);color:#cbd5e1;display:flex;gap:28px;align-items:center;justify-content:space-between;flex-wrap:wrap;box-shadow:0 24px 50px rgba(15,23,42,.18)}
.hpband .pair{display:flex;align-items:center;gap:10px;margin-bottom:12px;color:#94a3b8;font-weight:800}.hpband .pair img{width:40px;height:40px;border-radius:11px;background:#fff;padding:3px}
.hpband h3{color:#fff;font-size:22px;margin:0 0 6px}.hpband p{margin:0;max-width:640px;color:#cbd5e1}
.gtk{display:grid;gap:10px}.gtk div{display:flex;gap:12px;align-items:flex-start;padding:14px 16px;border-radius:14px;background:#fffbeb;border:1px solid #fde68a;color:#78350f}.gtk svg{color:#d97706;flex:none;margin-top:2px}
.faq details{border:1px solid var(--line);border-radius:14px;padding:0;margin:10px 0;background:#fff;overflow:hidden}
.faq summary{list-style:none;display:flex;justify-content:space-between;gap:16px;align-items:center;padding:16px 20px;font-weight:700;cursor:pointer}.faq summary::-webkit-details-marker{display:none}
.faq summary::after{content:"+";font-size:22px;font-weight:500;color:var(--muted);transition:transform .15s}.faq details[open] summary::after{transform:rotate(45deg)}
.faq details p{margin:0;padding:0 20px 18px;color:var(--muted)}
.alts{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.alts a{display:flex;gap:14px;align-items:center;border:1px solid var(--line);border-radius:16px;padding:16px;background:#fff;color:var(--text);transition:border-color .15s,box-shadow .15s}
.alts a:hover{border-color:#c7d7fe;box-shadow:0 12px 26px rgba(15,23,42,.07);text-decoration:none}
.alts img{width:44px;height:44px;border-radius:12px;box-shadow:0 0 0 1px var(--line);flex:none}.alts span{flex:1;min-width:0}.alts small{display:block;color:var(--muted);font-size:13.5px;margin-top:2px}.alts svg{color:var(--muted);flex:none}
.cmp-h{padding:10px 0 44px;max-width:820px}
.cmp2wrap{overflow-x:auto;border-radius:18px;box-shadow:0 0 0 1px var(--line),0 18px 40px rgba(15,23,42,.06);background:#fff}
.cmp2{width:100%;border-collapse:collapse;font-size:14.5px;min-width:760px}.cmp2 td:not(:first-child),.cmp2 th:not(:first-child){min-width:150px}
.cmp2 th,.cmp2 td{padding:15px 16px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
.cmp2 thead th{background:#f7f9fd;font-size:12px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);font-weight:800}
.cmp2 tbody tr:nth-child(even) td{background:#fbfcfe}.cmp2 tbody tr:hover td{background:#f3f7ff}
.cmp2 tr:last-child td{border-bottom:0}.cmp2 td:first-child{font-weight:700;white-space:nowrap;position:sticky;left:0;background:inherit}
.cmp2 td:first-child img{width:26px;height:26px;border-radius:7px;vertical-align:-8px;margin-right:10px;box-shadow:0 0 0 1px var(--line)}
.prose{max-width:780px}.prose p{color:#334155}
.foot-note{padding:40px 0 64px}.src{font-size:13px;color:var(--muted);margin-top:10px}.src summary{cursor:pointer;font-weight:600}.src a{color:var(--muted);text-decoration:underline}.src ol{padding-left:18px}
@media (max-width:900px){.ph{grid-template-columns:1fr;gap:28px}.glance{position:static}.feat,.alts{grid-template-columns:1fr}.ph h1,.cmp-h h1{font-size:34px}
.tl{grid-auto-flow:row}.tl::before{left:18px;right:auto;top:18px;bottom:18px;width:2px;height:auto}.tl li{display:flex;gap:14px;align-items:flex-start}.tl li::before{flex:none;margin:0}.tl li span{padding-top:8px}.hpband{padding:24px}}
</style>`;

const sources = (urls: string[], date: string) => urls.length ? `<details class="src"><summary>Sources · facts checked on ${esc(checked(date))}</summary><ol>${urls.map((u) => `<li><a href="${esc(u)}" rel="nofollow noopener" target="_blank">${esc(u.replace(/^https?:\/\/(www\.)?/, '').slice(0, 90))}</a></li>`).join('')}</ol></details>` : '';
const faqHtml = (faq: [string, string][]) => `<div class="faq">${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</div>`;
const faqLd = (faq: [string, string][]) => ({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) });
const crumbsLd = (items: [string, string][]) => ({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items.map(([n, p], i) => ({ '@type': 'ListItem', position: i + 1, name: n, item: SITE + p })) });
const catName = (c: PartnerCategory) => PARTNER_CATEGORIES.find((x) => x.id === c)?.name ?? c;
const comparisonFor = (c: PartnerCategory) => Object.values(COMPARISONS).find((x) => x.category === c || (c === 'business' && x.category === 'start'));
const domainOf = (u: string) => u.replace(/^https?:\/\/(www\.)?/, '').split('/')[0];
const ext = (href: string, cls: string, label: string) => `<a class="${cls}" href="${href}" target="_blank" rel="sponsored nofollow noopener">${label} ${icon('ext', 16)}</a>`;
const altCard = (id: string, from: string) => {
  const a = partner(id)!;
  return `<a href="${PROFILES[a.id] ? profilePath(a.id) : goHref(a.id, from)}"><img src="/logos/${a.id}.png" alt="" width="44" height="44" loading="lazy"><span><b>${esc(a.name)}</b><small>${esc(a.blurb)}</small></span>${icon('arrow', 18)}</a>`;
};
const haulBand = (title: string, text: string, logoId?: string) => `<div class="hpband"><div>${logoId ? `<div class="pair"><img src="/logos/${logoId}.png" alt="" width="40" height="40">+<img src="/logo.svg" alt="" width="40" height="40"></div>` : ''}<h3>${esc(title)}</h3><p>${esc(text)}</p></div><a class="btn primary big" href="/#/crm?signup">Try HaulPanel free</a></div>`;

/** /trucking-services/<company> */
export function profilePage(slug: string): string | null {
  const pr = Object.values(PROFILES).find((x) => x.slug === slug);
  if (!pr) return null;
  const p = partner(pr.id)!;
  const path = profilePath(pr.id);
  const go = (where: string) => goHref(p.id, `${pr.slug}-${where}`);
  const alts = PARTNERS.filter((x) => x.category === p.category && x.id !== p.id);
  const cmp = comparisonFor(p.category);
  const nav: [string, string][] = [['offers', 'Overview'], ['pricing', 'Pricing'], ['signup', 'How to sign up'], ...(pr.goodToKnow.length ? [['know', 'Good to know'] as [string, string]] : []), ['faq', 'FAQ'], ...(alts.length ? [['alternatives', 'Alternatives'] as [string, string]] : [])];
  const body = `${SVC_CSS}<div class="svc-hero"><div class="wrap">
<nav class="crumbs"><a href="/trucking-services">Trucking services</a> › ${esc(catName(p.category))} › ${esc(p.name)}</nav>
<div class="ph"><div>
<div class="ph-brand"><span class="ph-logo"><img src="/logos/${p.id}.png" alt="${esc(p.name)} logo" width="54" height="54"></span><span class="tag acc">${esc(catName(p.category))}</span><span class="tag">Independent overview</span></div>
<h1>${esc(pr.h1)}</h1>
<p class="lead">${esc(pr.lead)}</p>
<div class="actions">${ext(go('hero'), 'btn primary big', `Visit ${esc(p.name)}`)}${cmp ? `<a class="btn big" href="/trucking-services/${cmp.slug}">${esc(cmp.crumb)}</a>` : ''}</div>
<div class="trust"><span>${icon('check', 16)}Facts from ${esc(domainOf(p.url))}</span><span>${icon('check', 16)}Checked ${esc(checked(pr.updated))}</span><span>${icon('check', 16)}Sources listed</span></div>
</div>
<aside class="glance"><div class="glance-h"><img src="/logos/${p.id}.png" alt="" width="34" height="34"><span><small>At a glance</small><b>${esc(p.name)}</b></span></div>
<dl>${pr.glance.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
${ext(go('glance'), 'btn primary', 'Get started')}<p class="note">Opens ${esc(domainOf(p.url))}</p></aside>
</div></div></div>
<nav class="subnav" aria-label="On this page"><div class="wrap">${nav.map(([id, l]) => `<a href="#${id}">${esc(l)}</a>`).join('')}</div></nav>
<div class="wrap">
<section class="sec" id="offers"><span class="eyebrow">Overview</span><h2>What ${esc(p.name)} offers</h2><p class="sec-sub">${esc(p.blurb)} For ${esc(p.for.toLowerCase())}.</p>
<div class="feat">${pr.features.map((f) => `<div><i>${icon(iconFor(f.h), 21)}</i><h3>${esc(f.h)}</h3><p>${esc(f.p)}</p></div>`).join('')}</div></section>
<section class="sec" id="pricing"><span class="eyebrow">Pricing</span><h2>${esc(pr.pricingTitle ?? 'Pricing and terms')}</h2>
<div class="pricing-note">${icon('info', 18)}<span>${esc(pr.pricing)}</span></div>
${pr.plans?.length ? `<div class="plans">${pr.plans.map((x) => `<div><small>${esc(x.name)}</small><strong>${esc(x.price)}</strong><p>${esc(x.what)}</p></div>`).join('')}</div>` : ''}</section>
<section class="sec" id="signup"><span class="eyebrow">Getting started</span><h2>How to sign up</h2><p class="sec-sub">${pr.signup.length} steps from application to your first payment or load.</p>
<ol class="tl">${pr.signup.map((x) => `<li><span>${esc(x)}</span></li>`).join('')}</ol>
<div class="actions" style="margin-top:28px">${ext(go('signup'), 'btn primary', `Go to ${esc(p.name)}`)}</div></section>
<section class="sec">${haulBand(`${p.name} + HaulPanel`, pr.withHaulPanel, p.id)}</section>
${pr.goodToKnow.length ? `<section class="sec" id="know"><span class="eyebrow">Before you sign</span><h2>Good to know</h2><p class="sec-sub">Things worth confirming with ${esc(p.name)} in writing.</p><div class="gtk">${pr.goodToKnow.map((g) => `<div>${icon('info', 18)}<span>${esc(g)}</span></div>`).join('')}</div></section>` : ''}
<section class="sec" id="faq"><span class="eyebrow">FAQ</span><h2>Questions about ${esc(p.name)}</h2>${faqHtml(pr.faq)}</section>
${alts.length ? `<section class="sec" id="alternatives"><span class="eyebrow">Compare</span><h2>Alternatives to ${esc(p.name)}</h2><p class="sec-sub">Other ${esc(catName(p.category).toLowerCase())} our users look at.${cmp ? ` <a href="/trucking-services/${cmp.slug}">${esc(cmp.h1)} →</a>` : ''}</p><div class="alts">${alts.map((a) => altCard(a.id, pr.slug)).join('')}</div></section>` : ''}
<div class="foot-note"><p class="note">${esc(DISCLOSURE)} ${esc(p.name)} is a trademark of its owner; this page is not written or endorsed by ${esc(p.name)}.</p>${sources(pr.sources, pr.updated)}</div>
</div>`;
  return page({
    path, title: pr.title, description: pr.description, body, image: undefined,
    jsonLd: [
      { '@context': 'https://schema.org', '@type': 'WebPage', name: pr.title, url: SITE + path, dateModified: pr.updated, about: { '@type': 'Organization', name: p.name, url: p.url } },
      faqLd(pr.faq),
      crumbsLd([['Trucking services', '/trucking-services'], [p.name, path]]),
    ],
  });
}

/** /trucking-services/<comparison> */
export function comparisonPage(slug: string): string | null {
  const c = Object.values(COMPARISONS).find((x) => x.slug === slug);
  if (!c) return null;
  const rows = c.rows;
  const profiled = rows.filter((r) => r.id && PROFILES[r.id]);
  const body = `${SVC_CSS}<div class="svc-hero"><div class="wrap">
<nav class="crumbs"><a href="/trucking-services">Trucking services</a> › ${esc(c.crumb)}</nav>
<div class="cmp-h"><div class="ph-brand"><span class="tag acc">${esc(c.crumb)}</span><span class="tag">Updated ${esc(checked(c.updated))}</span></div><h1>${esc(c.h1)}</h1><p class="lead">${esc(c.lead)}</p>
<div class="trust"><span>${icon('check', 16)}From the companies’ own sites</span><span>${icon('check', 16)}No paid rankings</span><span>${icon('check', 16)}Sources listed</span></div></div>
</div></div>
<div class="wrap">
<section class="sec" style="padding-top:40px"><div class="cmp2wrap"><table class="cmp2"><thead><tr><th>${c.category === 'start' ? 'Step' : 'Company'}</th>${c.columns.map((x) => `<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>
${rows.map((r) => {
    const pt = r.id ? partner(r.id) : undefined;
    const name = pt ? `<img src="/logos/${pt.id}.png" alt="" width="26" height="26">${PROFILES[pt.id] ? `<a href="${profilePath(pt.id)}">${esc(r.name)}</a>` : esc(r.name)}` : r.url ? `<a href="${esc(r.url)}" rel="nofollow noopener" target="_blank">${esc(r.name)}</a>` : esc(r.name);
    return `<tr><td>${name}</td>${r.cells.map((x) => `<td>${esc(x)}</td>`).join('')}</tr>`;
  }).join('')}
</tbody></table></div></section>
${c.sections.map((s) => `<section class="sec prose"><h2>${esc(s.h)}</h2>${s.p.map((x) => `<p>${esc(x)}</p>`).join('')}</section>`).join('')}
${profiled.length ? `<section class="sec"><span class="eyebrow">Read more</span><h2>Company overviews</h2><div class="alts" style="margin-top:18px">${profiled.map((r) => altCard(r.id!, c.slug)).join('')}</div></section>` : ''}
<section class="sec">${haulBand('Keep every load, invoice and payment in one place', c.withHaulPanel)}</section>
<section class="sec"><span class="eyebrow">FAQ</span><h2>Questions</h2>${faqHtml(c.faq)}</section>
<div class="foot-note"><p class="note">${esc(DISCLOSURE)} Company names are trademarks of their owners.</p>${sources(c.sources, c.updated)}</div>
</div>`;
  return page({
    path: `/trucking-services/${c.slug}`, title: c.title, description: c.description, body,
    jsonLd: [faqLd(c.faq), crumbsLd([['Trucking services', '/trucking-services'], [c.crumb, `/trucking-services/${c.slug}`]]),
      { '@context': 'https://schema.org', '@type': 'Article', headline: c.h1, description: c.description, url: `${SITE}/trucking-services/${c.slug}`, dateModified: c.updated, datePublished: c.updated, author: { '@type': 'Organization', name: 'HaulPanel', url: SITE } }],
  });
}

/** Every page path under /trucking-services/, for routing and the sitemap. */
export const PARTNER_PAGE_PATHS = [...Object.keys(PROFILES).map(profilePath), ...Object.values(COMPARISONS).map((c) => `/trucking-services/${c.slug}`)];

/** A page under /trucking-services/, or null. */
export function partnerSubPage(path: string): string | null {
  const m = /^\/trucking-services\/([a-z0-9-]+)$/.exec(path);
  if (!m) return null;
  return profilePage(m[1]) ?? comparisonPage(m[1]);
}

export type { Comparison, Profile };
