import { esc, page, SITE } from './layout.js';
import { goHref, PARTNER_CATEGORIES, partner, PARTNERS, type PartnerCategory } from './partners.js';
import { COMPARISONS, PROFILES, type Comparison, type Profile } from './partner-profiles.js';

// A page for every recommended company (/trucking-services/<slug>) and comparison pages per category — facts from
// the companies' own sites, checked on the date shown, with sources. No invented ratings or reviews.

export const profilePath = (id: string) => `/trucking-services/${PROFILES[id]?.slug ?? id}`;
const checked = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const DISCLOSURE = 'Some links on this page are referral links: HaulPanel may earn a fee if you sign up, at no cost to you. It does not change what we write.';
const ICONS = ['✓', '◎', '▦', '✦', '⇄', '☰', '⌁', '$', '⏱'];

const CSS = `<style>
.ph{display:grid;grid-template-columns:minmax(0,1fr) 380px;gap:40px;align-items:start;padding:8px 0 40px}
.ph-brand{display:flex;align-items:center;gap:14px;margin:6px 0 4px}.ph-logo{width:64px;height:64px;border-radius:16px;border:1px solid var(--line);background:#fff;display:grid;place-items:center;overflow:hidden;box-shadow:0 8px 24px rgba(15,23,42,.08)}
.ph-logo img{width:48px;height:48px;object-fit:contain}
.ph .kicker{margin-bottom:6px}.ph h1{font-size:42px;margin:6px 0 10px}
.ph-meta{display:flex;gap:14px;flex-wrap:wrap;align-items:center;margin-top:14px;font-size:13.5px;color:var(--muted)}.ph-meta b{color:var(--text)}
.glance{border:1px solid var(--line);border-radius:18px;background:linear-gradient(180deg,var(--accent-soft),var(--bg) 120px);padding:22px;box-shadow:0 18px 40px rgba(15,23,42,.08);position:sticky;top:80px}
.glance h3{margin:0 0 10px;font-size:15px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.glance dl{margin:0}.glance div{display:flex;justify-content:space-between;gap:16px;padding:10px 0;border-bottom:1px solid var(--line)}.glance div:last-child{border:0}
.glance dt{color:var(--muted);font-size:14px;white-space:nowrap}.glance dd{margin:0;font-weight:700;font-size:14.5px;text-align:right}
.glance .btn{width:100%;margin-top:16px}
.sec{padding:40px 0;border-top:1px solid var(--line)}.sec h2{margin-bottom:18px}
.feat{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.feat div{border:1px solid var(--line);border-radius:14px;padding:18px;background:var(--bg)}
.feat i{display:grid;place-items:center;width:36px;height:36px;border-radius:10px;background:var(--accent-soft);color:var(--accent);font-style:normal;margin-bottom:10px}
.feat h3{font-size:16px}.feat p{margin:0;color:var(--muted);font-size:14.5px}
.plans{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin-top:14px}.plans div{border:1px solid var(--line);border-radius:14px;padding:18px}
.plans b{display:block;font-size:16px}.plans strong{display:block;font-size:22px;margin:6px 0;letter-spacing:-.01em}.plans p{margin:0;color:var(--muted);font-size:14px}
.steps2{counter-reset:s;list-style:none;padding:0;margin:0;display:grid;gap:12px}.steps2 li{counter-increment:s;display:flex;gap:14px;align-items:flex-start;border:1px solid var(--line);border-radius:14px;padding:14px 16px}
.steps2 li::before{content:counter(s);flex:none;display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:var(--accent);color:#fff;font-weight:800;font-size:14px}
.hp{display:flex;gap:20px;align-items:center;justify-content:space-between;flex-wrap:wrap;border-radius:18px;padding:24px;background:#0f172a;color:#e2e8f0}.hp h3{color:#fff;font-size:20px}.hp p{margin:0;color:#cbd5e1;max-width:640px}
.gtk{border-left:4px solid #f59e0b;background:#fffbeb;border-radius:12px;padding:16px 20px}.gtk ul{margin:0;padding-left:18px}.gtk li{margin:6px 0}
.alts{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.alts a{display:flex;gap:12px;align-items:center;border:1px solid var(--line);border-radius:14px;padding:14px;color:var(--text)}.alts a:hover{border-color:var(--accent);text-decoration:none}
.alts img{width:36px;height:36px;border-radius:9px}.alts small{display:block;color:var(--muted)}
.cmp2{width:100%;border-collapse:separate;border-spacing:0;border:1px solid var(--line);border-radius:14px;overflow:hidden;font-size:14.5px}
.cmp2 th,.cmp2 td{padding:12px 14px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}.cmp2 thead th{background:var(--soft);font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
.cmp2 tr:last-child td{border-bottom:0}.cmp2 td:first-child{font-weight:700;white-space:nowrap}.cmp2 td:first-child img{width:22px;height:22px;border-radius:6px;vertical-align:-5px;margin-right:8px}
.cmpwrap{overflow-x:auto}
.src{font-size:13px;color:var(--muted)}.src a{color:var(--muted);text-decoration:underline}.src ol{padding-left:18px}
.prose{max-width:780px}.prose h3{margin-top:22px}
@media (max-width:900px){.ph-meta span:nth-child(2){display:none}.ph{grid-template-columns:1fr}.glance{position:static}.feat,.alts{grid-template-columns:1fr}.ph h1{font-size:32px}}
</style>`;

const sources = (urls: string[], date: string) => urls.length ? `<details class="src"><summary>Sources · facts checked on ${esc(checked(date))}</summary><ol>${urls.map((u) => `<li><a href="${esc(u)}" rel="nofollow noopener" target="_blank">${esc(u.replace(/^https?:\/\/(www\.)?/, '').slice(0, 90))}</a></li>`).join('')}</ol></details>` : '';
const faqHtml = (faq: [string, string][]) => faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('');
const faqLd = (faq: [string, string][]) => ({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) });
const crumbsLd = (items: [string, string][]) => ({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items.map(([n, p], i) => ({ '@type': 'ListItem', position: i + 1, name: n, item: SITE + p })) });
const catName = (c: PartnerCategory) => PARTNER_CATEGORIES.find((x) => x.id === c)?.name ?? c;
const comparisonFor = (c: PartnerCategory) => Object.values(COMPARISONS).find((x) => x.category === c || (c === 'business' && x.category === 'start'));

/** /trucking-services/<company> */
export function profilePage(slug: string): string | null {
  const pr = Object.values(PROFILES).find((x) => x.slug === slug);
  if (!pr) return null;
  const p = partner(pr.id)!;
  const path = profilePath(pr.id);
  const go = (where: string) => goHref(p.id, `${pr.slug}-${where}`);
  const alts = PARTNERS.filter((x) => x.category === p.category && x.id !== p.id);
  const cmp = comparisonFor(p.category);
  const body = `${CSS}<div class="wrap">
<nav class="crumbs"><a href="/trucking-services">Trucking services</a> › ${esc(catName(p.category))} › ${esc(p.name)}</nav>
<div class="ph"><div>
<div class="ph-brand"><span class="ph-logo"><img src="/logos/${p.id}.png" alt="${esc(p.name)} logo" width="48" height="48"></span><span class="kicker">✦ ${esc(catName(p.category))}</span></div>
<h1>${esc(pr.h1)}</h1>
<p class="lead">${esc(pr.lead)}</p>
<div class="actions"><a class="btn primary big" href="${go('hero')}" target="_blank" rel="sponsored nofollow noopener">Visit ${esc(p.name)} ↗</a>${cmp ? `<a class="btn big" href="/trucking-services/${cmp.slug}">${esc(cmp.crumb)}</a>` : ''}</div>
<div class="ph-meta"><span>Facts checked <b>${esc(checked(pr.updated))}</b> from the company’s own site</span><span>·</span><span>Independent page by HaulPanel</span></div>
</div>
<aside class="glance"><h3>At a glance</h3><dl>${pr.glance.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
<a class="btn primary" href="${go('glance')}" target="_blank" rel="sponsored nofollow noopener">Get started ↗</a></aside>
</div>
<section class="sec"><h2>What ${esc(p.name)} offers</h2><div class="feat">${pr.features.map((f, i) => `<div><i aria-hidden="true">${ICONS[i % ICONS.length]}</i><h3>${esc(f.h)}</h3><p>${esc(f.p)}</p></div>`).join('')}</div></section>
<section class="sec"><h2>${esc(pr.pricingTitle ?? 'Pricing and terms')}</h2><p class="muted" style="max-width:760px">${esc(pr.pricing)}</p>
${pr.plans?.length ? `<div class="plans">${pr.plans.map((x) => `<div><b>${esc(x.name)}</b><strong>${esc(x.price)}</strong><p>${esc(x.what)}</p></div>`).join('')}</div>` : ''}</section>
<section class="sec"><h2>How to sign up</h2><ol class="steps2">${pr.signup.map((s) => `<li><span>${esc(s)}</span></li>`).join('')}</ol>
<div class="actions"><a class="btn primary" href="${go('signup')}" target="_blank" rel="sponsored nofollow noopener">Go to ${esc(p.name)} ↗</a></div></section>
<section class="sec"><div class="hp"><div><h3>${esc(p.name)} + HaulPanel</h3><p>${esc(pr.withHaulPanel)}</p></div><a class="btn primary big" href="/#/crm?signup">Try HaulPanel free</a></div></section>
${pr.goodToKnow.length ? `<section class="sec"><h2>Good to know</h2><div class="gtk"><ul>${pr.goodToKnow.map((g) => `<li>${esc(g)}</li>`).join('')}</ul></div></section>` : ''}
<section class="sec"><h2>Questions about ${esc(p.name)}</h2>${faqHtml(pr.faq)}</section>
${alts.length ? `<section class="sec"><h2>Alternatives to ${esc(p.name)}</h2><div class="alts">${alts.map((a) => `<a href="${PROFILES[a.id] ? profilePath(a.id) : goHref(a.id, pr.slug)}"><img src="/logos/${a.id}.png" alt="" width="36" height="36" loading="lazy"><span><b>${esc(a.name)}</b><small>${esc(a.blurb)}</small></span></a>`).join('')}</div>
${cmp ? `<p style="margin-top:14px"><a href="/trucking-services/${cmp.slug}">${esc(cmp.h1)} →</a></p>` : ''}</section>` : ''}
<section class="sec" style="padding-bottom:56px"><p class="note">${esc(DISCLOSURE)} ${esc(p.name)} is a trademark of its owner; this page is not written or endorsed by ${esc(p.name)}.</p>${sources(pr.sources, pr.updated)}</section>
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
  const c = Object.values(COMPARISONS).find((x) => `/trucking-services/${x.slug}` === `/trucking-services/${slug}`);
  if (!c) return null;
  const rows = c.rows;
  const body = `${CSS}<div class="wrap">
<nav class="crumbs"><a href="/trucking-services">Trucking services</a> › ${esc(c.crumb)}</nav>
<div style="padding:8px 0 28px"><span class="kicker">✦ Updated ${esc(checked(c.updated))}</span><h1>${esc(c.h1)}</h1><p class="lead">${esc(c.lead)}</p></div>
<section class="sec" style="border-top:0;padding-top:0"><div class="cmpwrap"><table class="cmp2"><thead><tr><th></th>${c.columns.map((x) => `<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>
${rows.map((r) => {
    const pt = r.id ? partner(r.id) : undefined;
    const name = pt ? `<img src="/logos/${pt.id}.png" alt="" width="22" height="22">${PROFILES[pt.id] ? `<a href="${profilePath(pt.id)}">${esc(r.name)}</a>` : esc(r.name)}` : r.url ? `<a href="${esc(r.url)}" rel="nofollow noopener" target="_blank">${esc(r.name)}</a>` : esc(r.name);
    return `<tr><td>${name}</td>${r.cells.map((x) => `<td>${esc(x)}</td>`).join('')}</tr>`;
  }).join('')}
</tbody></table></div></section>
${c.sections.map((s) => `<section class="sec prose"><h2>${esc(s.h)}</h2>${s.p.map((x) => `<p>${esc(x)}</p>`).join('')}</section>`).join('')}
${rows.some((r) => r.id && PROFILES[r.id]) ? `<section class="sec"><h2>Read more</h2><div class="alts">${rows.filter((r) => r.id && PROFILES[r.id]).map((r) => { const pt = partner(r.id!)!; return `<a href="${profilePath(pt.id)}"><img src="/logos/${pt.id}.png" alt="" width="36" height="36" loading="lazy"><span><b>${esc(pt.name)}</b><small>${esc(pt.blurb)}</small></span></a>`; }).join('')}</div></section>` : ''}
<section class="sec"><div class="hp"><div><h3>Keep every load, invoice and payment in one place</h3><p>${esc(c.withHaulPanel)}</p></div><a class="btn primary big" href="/#/crm?signup">Try HaulPanel free</a></div></section>
<section class="sec"><h2>Questions</h2>${faqHtml(c.faq)}</section>
<section class="sec" style="padding-bottom:56px"><p class="note">${esc(DISCLOSURE)} Company names are trademarks of their owners.</p>${sources(c.sources, c.updated)}</section>
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
