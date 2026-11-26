import { companiesStore, slug, titleCase, type PlaceStats, type PublicCompany } from './companies.store.js';
import { esc, page, SITE, stateName, STATES } from './layout.js';

// Public company pages: /mc/<number> for every active company with an MC number, and the directory that links
// them (/carriers → state → city), so search engines can reach all of them.

const KINDS: Record<string, string> = { C: 'Carrier', B: 'Broker', S: 'Shipper', F: 'Freight forwarder', I: 'Cargo tank', R: 'Registrant', T: 'Intermodal equipment provider' };
const OPERATION: Record<string, string> = { A: 'Interstate', B: 'Intrastate (hazmat)', C: 'Intrastate (non-hazmat)' };
const PER_PAGE = 100;

export const kindsOf = (c: Pick<PublicCompany, 'kinds'>) => c.kinds.split(/[,;\s]+/).filter(Boolean).map((k) => KINDS[k] ?? k);
const isBrokerOnly = (c: PublicCompany) => { const k = kindsOf(c); return k.includes('Broker') && !k.includes('Carrier'); };
const role = (c: PublicCompany) => (isBrokerOnly(c) ? 'freight broker' : kindsOf(c).includes('Broker') ? 'carrier and freight broker' : 'motor carrier');
const place = (c: Pick<PublicCompany, 'city' | 'state'>) => [titleCase(c.city), c.state].filter(Boolean).join(', ');
const n = (v: number | null) => (v == null ? '—' : v.toLocaleString('en-US'));
const since = (d: string | null) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : '—');
const years = (d: string | null) => (d ? Math.floor((Date.now() - Date.parse(`${d}T12:00:00Z`)) / (365.25 * 86_400_000)) : null);
const name = (c: PublicCompany) => titleCaseName(c.name);
/** Company names keep their abbreviations (LLC, INC, USA) but stop shouting. */
function titleCaseName(s: string) {
  return s.split(' ').map((w) => (/^(LLC|INC|LTD|CO|CORP|USA|US|LP|LLP|PC|DBA|II|III|IV|[A-Z]{1,2}|[A-Z]&[A-Z])\.?$/.test(w) ? w : w.charAt(0) + w.slice(1).toLowerCase())).join(' ');
}
const lookupHref = (mc: number) => `/mc-number-lookup#/lookup?q=${mc}&type=mc`;
const stateHref = (st: string) => `/carriers/${st.toLowerCase()}`;
const cityHref = (st: string, city: string) => `/carriers/${st.toLowerCase()}/${slug(city)}`;

/** /mc/<number> */
export async function companyPage(mc: number): Promise<{ status: number; html: string }> {
  const c = await companiesStore.byMc(mc);
  if (!c) return { status: 404, html: notFound(mc) };
  const nm = name(c);
  const where = place(c);
  const age = years(c.addedOn);
  const fleet = c.powerUnits ? `${n(c.powerUnits)} power unit${c.powerUnits === 1 ? '' : 's'}` : '';
  const drivers = c.drivers ? `${n(c.drivers)} driver${c.drivers === 1 ? '' : 's'}` : '';
  const neighbors = c.city ? await companiesStore.neighbors(c) : [];
  const title = `${nm} — MC ${c.mc}, USDOT ${c.dot}${where ? ` · ${where}` : ''} | HaulPanel`;
  const description = `${nm} (MC ${c.mc}, USDOT ${c.dot}) is a ${role(c)}${where ? ` in ${where}` : ''}${fleet ? ` with ${fleet}${drivers ? ` and ${drivers}` : ''}` : ''}. Check its authority, insurance and safety before you book.`;
  const facts: [string, string][] = [
    ['MC number', `MC-${c.mc}`],
    ['USDOT number', String(c.dot)],
    ['USDOT status', 'Active'],
    ['Type', kindsOf(c).join(', ') || '—'],
    ['Operation', OPERATION[c.operation] ?? (c.operation || '—')],
    ['Location', where || '—'],
    ['Power units', n(c.powerUnits)],
    ['Drivers', n(c.drivers)],
    ['Registered with FMCSA', `${since(c.addedOn)}${age != null && age > 0 ? ` (${age} year${age === 1 ? '' : 's'})` : ''}`],
    ['Last MCS-150 update', since(c.mcs150On)],
  ];
  const body = `<div class="wrap">
<nav class="crumbs"><a href="/carriers">Carrier directory</a>${c.state && STATES[c.state] ? ` › <a href="${stateHref(c.state)}">${esc(stateName(c.state))}</a>` : ''}${c.city && STATES[c.state] ? ` › <a href="${cityHref(c.state, c.city)}">${esc(titleCase(c.city))}</a>` : ''}</nav>
<div class="cols"><div>
<h1>${esc(nm)}</h1>
<p class="lead">${c.dba ? `Doing business as <b>${esc(titleCaseName(c.dba))}</b>. ` : ''}${esc(description.replace(/ Check its.*$/, ''))}</p>
<p><span class="pill">● USDOT active</span></p>
<dl class="facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
${c.cargo.length ? `<h2>Cargo carried</h2><p class="muted">${c.cargo.map(esc).join(' · ')}</p>` : ''}
<h2>Before you work with ${esc(nm)}</h2>
<p class="muted">The facts above come from the FMCSA company census, updated weekly. Operating authority can be revoked and insurance can lapse at any time — check them live before you book a load or pay an invoice.</p>
<div class="actions"><a class="btn primary big" href="${lookupHref(c.mc)}">Check authority &amp; insurance live</a><a class="btn big" href="https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&amp;query_type=queryCarrierSnapshot&amp;query_param=USDOT&amp;query_string=${c.dot}" rel="nofollow noopener">FMCSA SAFER snapshot</a></div>
<p class="note">HaulPanel’s check shows authority status and history, insurance on file and its history, and other companies that share the same phone or email — a common sign of fraud.</p>
${neighbors.length ? `<h2 style="margin-top:36px">Other ${isBrokerOnly(c) ? 'companies' : 'carriers'} in ${esc(where)}</h2>
<ul class="list">${neighbors.map((x) => `<li><a href="/mc/${x.mc}">${esc(name(x))}</a><small>MC ${x.mc}${x.powerUnits ? ` · ${n(x.powerUnits)} truck${x.powerUnits === 1 ? '' : 's'}` : ''}</small></li>`).join('')}</ul>
<p style="margin-top:12px"><a href="${cityHref(c.state, c.city)}">All companies in ${esc(where)} →</a></p>` : ''}
</div>
<aside>
<div class="box"><h3>Dispatch or broker loads with ${esc(isBrokerOnly(c) ? 'brokers like this one' : 'carriers like this one')}?</h3>
<p class="muted">HaulPanel is a free TMS with an AI assistant: rate cons become loads, BOLs and PODs file themselves, invoices are one click.</p>
<a class="btn primary" style="width:100%" href="/#/crm?signup">Start free</a><p class="note">Free during beta · no credit card</p></div>
<div class="box"><h3>Find new carriers</h3><p class="muted">150+ carriers get their MC authority every day. See them with phone and email.</p><a href="/new-mc-leads">New MC leads →</a></div>
</aside></div></div>`;
  return {
    status: 200,
    html: page({
      path: `/mc/${c.mc}`, title, description, body,
      jsonLd: [
        { '@context': 'https://schema.org', '@type': 'Organization', name: nm, ...(c.dba ? { alternateName: titleCaseName(c.dba) } : {}), url: `${SITE}/mc/${c.mc}`,
          ...(where ? { address: { '@type': 'PostalAddress', addressLocality: titleCase(c.city), addressRegion: c.state, addressCountry: 'US' } } : {}),
          identifier: [{ '@type': 'PropertyValue', propertyID: 'MC', value: String(c.mc) }, { '@type': 'PropertyValue', propertyID: 'USDOT', value: String(c.dot) }],
          ...(c.drivers ? { numberOfEmployees: { '@type': 'QuantitativeValue', value: c.drivers } } : {}) },
        breadcrumbs([['Carrier directory', '/carriers'], ...(STATES[c.state] ? [[stateName(c.state), stateHref(c.state)] as [string, string]] : []), [nm, `/mc/${c.mc}`]]),
      ],
    }),
  };
}

function notFound(mc: number) {
  return page({
    path: `/mc/${mc}`, noindex: true, title: `MC ${mc} | HaulPanel`, description: `No active company with MC ${mc} in the FMCSA census.`,
    body: `<div class="wrap" style="padding:56px 20px"><h1>MC ${mc}</h1><p class="lead">There is no company with an active USDOT number and MC ${mc} in the FMCSA census we keep. It may be inactive, revoked or brand new.</p>
<div class="actions"><a class="btn primary big" href="${lookupHref(mc)}">Search FMCSA live for MC ${mc}</a><a class="btn big" href="/carriers">Carrier directory</a></div></div>`,
  });
}

const breadcrumbs = (items: [string, string][]) => ({
  '@context': 'https://schema.org', '@type': 'BreadcrumbList',
  itemListElement: items.map(([nm, href], i) => ({ '@type': 'ListItem', position: i + 1, name: nm, item: SITE + href })),
});

/** /carriers */
export async function directoryPage(): Promise<{ status: number; html: string }> {
  const [all, top] = await Promise.all([companiesStore.states(), companiesStore.topCities(60)]);
  const states = all.filter((s) => STATES[s.state]);
  const total = states.reduce((a, s) => a + s.n, 0);
  const body = `<div class="wrap" style="padding:32px 20px 56px">
<h1>Trucking company directory</h1>
<p class="lead">${total ? `${total.toLocaleString('en-US')} carriers and freight brokers` : 'Carriers and freight brokers'} with an active USDOT number and an MC number, from FMCSA public records — by state and city. Every company has its own page with MC, USDOT, fleet size and a live authority and insurance check.</p>
<h2 style="margin-top:28px">By state</h2>
<ul class="cityl">${states.map((s) => `<li><a href="${stateHref(s.state)}">Trucking companies in ${esc(stateName(s.state))}</a> <small>${s.n.toLocaleString('en-US')}</small></li>`).join('')}</ul>
${top.length ? `<h2 style="margin-top:32px">Cities with the most trucking companies</h2>
<ul class="cityl">${top.filter((c) => STATES[c.state]).map((c) => `<li><a href="${cityHref(c.state, c.city)}">${esc(titleCase(c.city))}, ${c.state}</a> <small>${c.n.toLocaleString('en-US')}</small></li>`).join('')}</ul>` : ''}
</div>`;
  return { status: 200, html: page({ path: '/carriers', title: 'Trucking Company Directory — Carriers & Brokers by State | HaulPanel', description: 'Every active trucking company and freight broker with an MC number, by state and city: MC, USDOT, fleet size, and a live authority and insurance check.', body, jsonLd: [breadcrumbs([['Carrier directory', '/carriers']])] }) };
}

/** /carriers/<state> */
export async function statePage(st: string, pageNo: number): Promise<{ status: number; html: string } | null> {
  const state = st.toUpperCase();
  // The state list goes 20 pages deep (largest fleets); every company is also reachable from its city.
  if (!STATES[state] || pageNo > 20) return null;
  const [cities, list, st0] = await Promise.all([companiesStore.cities(state), companiesStore.list(state, null, (pageNo - 1) * PER_PAGE, PER_PAGE), pageNo === 1 ? companiesStore.stats(state, null) : null]);
  if (!list.total) return null;
  const nm = stateName(state);
  const sum = st0 && placeSummary(nm, st0, list.rows, cities[0] ? `${titleCase(cities[0].city)} (${cities[0].n.toLocaleString('en-US')})` : '');
  const path = `${stateHref(state)}${pageNo > 1 ? `?page=${pageNo}` : ''}`;
  const body = `<div class="wrap" style="padding-bottom:56px">
<nav class="crumbs"><a href="/carriers">Carrier directory</a> › ${esc(nm)}</nav>
<h1>Trucking companies in ${esc(nm)}</h1>
<p class="lead">${sum ? sum.lead : `${list.total.toLocaleString('en-US')} carriers and freight brokers based in ${esc(nm)} with an active USDOT number and MC authority.`}</p>
${sum ? sum.facts : ''}
${pageNo === 1 ? `<h2 style="margin-top:28px">Cities</h2><ul class="cityl">${cities.slice(0, 300).map((x) => `<li><a href="${cityHref(state, x.city)}">${esc(titleCase(x.city))}</a> <small>${x.n}</small></li>`).join('')}</ul>` : ''}
<h2 style="margin-top:32px">Largest fleets${pageNo > 1 ? ` — page ${pageNo}` : ''}</h2>
${companyList(list.rows)}
${pager(stateHref(state), pageNo, Math.min(list.total, 20 * PER_PAGE))}
${sum ? sum.more : ''}
</div>`;
  return { status: 200, html: page({ path, title: `Trucking Companies in ${nm} (${(st0?.total ?? list.total).toLocaleString('en-US')}) — List with MC & USDOT${pageNo > 1 ? `, page ${pageNo}` : ''}`, description: sum ? sum.description : `${list.total.toLocaleString('en-US')} trucking companies and freight brokers in ${nm} with active USDOT and MC numbers, by city: fleet size, MC, USDOT and a live authority check.`, body, jsonLd: [breadcrumbs([['Carrier directory', '/carriers'], [nm, stateHref(state)]]), ...(sum ? [sum.faqLd] : [])] }) };
}

/** /carriers/<state>/<city> */
export async function cityPage(st: string, citySlug: string, pageNo: number): Promise<{ status: number; html: string } | null> {
  const state = st.toUpperCase();
  if (!STATES[state]) return null;
  const [list, st0, cities] = await Promise.all([companiesStore.list(state, citySlug, (pageNo - 1) * PER_PAGE, PER_PAGE), pageNo === 1 ? companiesStore.stats(state, citySlug) : null, companiesStore.cities(state)]);
  if (!list.total) return null;
  const city = titleCase(list.rows[0]?.city ?? citySlug.replace(/-/g, ' '));
  const where = `${city}, ${state}`;
  const base = `${stateHref(state)}/${citySlug}`;
  const sum = st0 && st0.total >= 3 ? placeSummary(where, st0, list.rows, '') : null;
  const others = cities.filter((x) => x.slug !== citySlug).slice(0, 24);
  const body = `<div class="wrap" style="padding-bottom:56px">
<nav class="crumbs"><a href="/carriers">Carrier directory</a> › <a href="${stateHref(state)}">${esc(stateName(state))}</a> › ${esc(city)}</nav>
<h1>Trucking companies in ${esc(where)}</h1>
<p class="lead">${sum ? sum.lead : `${list.total.toLocaleString('en-US')} carrier${list.total === 1 ? '' : 's'} and freight broker${list.total === 1 ? '' : 's'} based in ${esc(where)} with an active USDOT number and MC authority, largest fleets first.`}</p>
${sum ? sum.facts : ''}
<h2 style="margin-top:28px">${list.total > 1 ? 'Largest fleets first' : 'Company'}${pageNo > 1 ? ` — page ${pageNo}` : ''}</h2>
${companyList(list.rows)}
${pager(base, pageNo, list.total)}
${sum ? sum.more : ''}
${others.length ? `<h2 style="margin-top:36px">Other cities in ${esc(stateName(state))}</h2>
<ul class="cityl">${others.map((x) => `<li><a href="${cityHref(state, x.city)}">${esc(titleCase(x.city))}</a> <small>${x.n.toLocaleString('en-US')}</small></li>`).join('')}</ul>
<p style="margin-top:12px"><a href="${stateHref(state)}">All trucking companies in ${esc(stateName(state))} →</a></p>` : ''}
</div>`;
  // A city with one or two companies is too thin a page for search; people still reach it from the lists.
  return { status: 200, html: page({ path: `${base}${pageNo > 1 ? `?page=${pageNo}` : ''}`, noindex: list.total < 3, title: `Trucking Companies in ${where} (${(sum && st0 ? st0.total : list.total).toLocaleString('en-US')}) — List with MC & USDOT${pageNo > 1 ? `, page ${pageNo}` : ''}`, description: sum ? sum.description : `${list.total} trucking companies and freight brokers in ${where}: MC and USDOT numbers, fleet size and a live authority and insurance check for each.`, body, jsonLd: [breadcrumbs([['Carrier directory', '/carriers'], [stateName(state), stateHref(state)], [city, base]]), ...(sum ? [sum.faqLd] : [])] }) };
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const num = (v: number) => v.toLocaleString('en-US');

/**
 * The part of a state or city page written from its own numbers: a lead paragraph, key figures, the freight hauled,
 * the newest companies and answers to the questions people search for. Every place gets different text.
 */
export function placeSummary(where: string, s: PlaceStats, largest: PublicCompany[], topCity: string) {
  const big = largest.filter((c, i, xs) => c.powerUnits && xs.findIndex((o) => o.dot === c.dot) === i).slice(0, 3);
  const fleetWord = (c: PublicCompany) => `${num(c.powerUnits ?? 0)} truck${c.powerUnits === 1 ? '' : 's'}`;
  const parts = [
    `${num(s.total)} trucking ${s.total === 1 ? 'company is' : 'companies are'} based in ${where} with an active USDOT number and MC authority: ${num(s.carriers)} motor carrier${s.carriers === 1 ? '' : 's'} and ${num(s.brokers)} freight broker${s.brokers === 1 ? '' : 's'}.`,
    s.trucks ? `Together they run ${num(s.trucks)} truck${s.trucks === 1 ? '' : 's'}${s.drivers ? ` with ${num(s.drivers)} driver${s.drivers === 1 ? '' : 's'}` : ''}${s.solo ? `; ${pct(s.solo, s.total)}% are one-truck owner-operators` : ''}.` : '',
    big[0] ? `By trucks reported to FMCSA, the largest fleet is ${name(big[0])} (${fleetWord(big[0])})${big.length > 1 ? `, followed by ${big.slice(1).map((c) => `${name(c)} (${fleetWord(c)})`).join(' and ')}` : ''}.` : '',
    s.newYear ? `${num(s.newYear)} got their USDOT number in the last 12 months.` : '',
    topCity ? `Most are in ${topCity}.` : '',
  ].filter(Boolean);
  const lead = esc(parts.join(' '));
  const facts = `<dl class="facts">${([
    ['Companies with MC', num(s.total)], ['Motor carriers', num(s.carriers)], ['Freight brokers', num(s.brokers)], ['Trucks (power units)', num(s.trucks)],
    ['Owner-operators (1 truck)', `${num(s.solo)}${s.total ? ` · ${pct(s.solo, s.total)}%` : ''}`], ['Fleets of 2–10 trucks', num(s.small)],
    ['Fleets of 11–100 trucks', num(s.mid)], ['Fleets over 100 trucks', num(s.large)],
    ['New in the last 12 months', num(s.newYear)], ['Interstate operation', `${pct(s.interstate, s.total)}%`],
  ] as [string, string][]).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
  const freight = s.cargo.length ? `Most common freight: ${s.cargo.map((c) => `${c.name} (${num(c.n)})`).join(', ')}.` : '';
  const qa: [string, string][] = [
    [`How many trucking companies are in ${where}?`, `${num(s.total)} companies based in ${where} have an active USDOT number and MC authority: ${num(s.carriers)} motor carriers and ${num(s.brokers)} freight brokers. The list comes from the FMCSA company census and is updated weekly.`],
    ...(big[0] ? [[`What is the largest trucking company in ${where}?`, `By trucks reported to FMCSA, ${name(big[0])} (MC ${big[0].mc}) is the largest with ${fleetWord(big[0])}${big[1] ? `, then ${big.slice(1).map((c) => `${name(c)} (${fleetWord(c)})`).join(' and ')}` : ''}.`] as [string, string]] : []),
    [`How many new trucking companies are in ${where}?`, `${num(s.newYear)} companies in ${where} got their USDOT number in the last 12 months. Carriers that got their MC authority this week, with phone and email, are in HaulPanel’s New MC leads.`],
    [`How do I check a trucking company in ${where} before booking a load?`, `Open the company’s page and press “Check authority & insurance live”: it shows the operating authority and its history, insurance on file, and other companies that share the same phone or email — a common sign of fraud.`],
  ];
  const more = `${freight ? `<h2 style="margin-top:32px">Freight hauled</h2><p class="muted">${esc(freight)}</p>` : ''}
${s.newest.length ? `<h2 style="margin-top:32px">Newest companies in ${esc(where)}</h2>
<ul class="list">${s.newest.map((x) => `<li><span><a href="/mc/${x.mc}">${esc(name(x))}</a>${x.city ? ` <small class="muted">${esc(titleCase(x.city))}</small>` : ''}</span><small>MC ${x.mc}${x.addedOn ? ` · since ${since(x.addedOn)}` : ''}</small></li>`).join('')}</ul>
<p style="margin-top:12px"><a href="/new-mc-leads">New MC leads with phone and email, every day →</a></p>` : ''}
<h2 style="margin-top:36px">Questions</h2>
${qa.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}`;
  const description = `List of ${num(s.total)} trucking companies in ${where}: ${num(s.carriers)} carriers and ${num(s.brokers)} freight brokers${s.trucks ? ` running ${num(s.trucks)} trucks` : ''}. ${s.newYear ? `${num(s.newYear)} new this year. ` : ''}MC, USDOT, fleet size and a live authority check.`;
  const faqLd = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: qa.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) };
  return { lead, facts, more, description, faqLd };
}

function companyList(rows: PublicCompany[]) {
  return `<ul class="list">${rows.map((x) => `<li><span><a href="/mc/${x.mc}">${esc(name(x))}</a>${x.city ? ` <small class="muted">${esc(titleCase(x.city))}</small>` : ''}</span><small>${kindsOf(x).includes('Broker') && !kindsOf(x).includes('Carrier') ? 'Broker · ' : ''}MC ${x.mc}${x.powerUnits ? ` · ${n(x.powerUnits)} truck${x.powerUnits === 1 ? '' : 's'}` : ''}</small></li>`).join('')}</ul>`;
}

function pager(base: string, pageNo: number, total: number) {
  const last = Math.ceil(total / PER_PAGE);
  if (last <= 1) return '';
  return `<div class="pager"><span>${pageNo > 1 ? `<a class="btn" href="${base}${pageNo > 2 ? `?page=${pageNo - 1}` : ''}">← Previous</a>` : ''}</span><span class="muted" style="align-self:center">Page ${pageNo} of ${last}</span><span>${pageNo < last ? `<a class="btn" href="${base}?page=${pageNo + 1}">Next →</a>` : ''}</span></div>`;
}
