import { companiesStore, slug, titleCase, type PublicCompany } from './companies.store.js';
import { esc, page, SITE, stateName, STATES } from './layout.js';

// Public company pages: /mc/<number> for every active company with an MC number, and the directory that links
// them (/carriers → state → city), so search engines can reach all of them.

const KINDS: Record<string, string> = { C: 'Carrier', B: 'Broker', S: 'Shipper', F: 'Freight forwarder', I: 'Cargo tank', R: 'Registrant', T: 'Intermodal equipment provider' };
const OPERATION: Record<string, string> = { A: 'Interstate', B: 'Intrastate (hazmat)', C: 'Intrastate (non-hazmat)' };
const PER_PAGE = 100;

export const kindsOf = (c: Pick<PublicCompany, 'kinds'>) => c.kinds.split(/[,\s]+/).filter(Boolean).map((k) => KINDS[k] ?? k);
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
  const states = (await companiesStore.states()).filter((s) => STATES[s.state]);
  const total = states.reduce((a, s) => a + s.n, 0);
  const body = `<div class="wrap" style="padding:32px 20px 56px">
<h1>Trucking company directory</h1>
<p class="lead">${total ? `${total.toLocaleString('en-US')} carriers and freight brokers` : 'Carriers and freight brokers'} with an active USDOT number and an MC number, from FMCSA public records — by state and city. Every company has its own page with MC, USDOT, fleet size and a live authority and insurance check.</p>
<ul class="cityl" style="margin-top:24px">${states.map((s) => `<li><a href="${stateHref(s.state)}">${esc(stateName(s.state))}</a> <small>${s.n.toLocaleString('en-US')}</small></li>`).join('')}</ul>
</div>`;
  return { status: 200, html: page({ path: '/carriers', title: 'Trucking Company Directory — Carriers & Brokers by State | HaulPanel', description: 'Every active trucking company and freight broker with an MC number, by state and city: MC, USDOT, fleet size, and a live authority and insurance check.', body, jsonLd: [breadcrumbs([['Carrier directory', '/carriers']])] }) };
}

/** /carriers/<state> */
export async function statePage(st: string, pageNo: number): Promise<{ status: number; html: string } | null> {
  const state = st.toUpperCase();
  // The state list goes 20 pages deep (largest fleets); every company is also reachable from its city.
  if (!STATES[state] || pageNo > 20) return null;
  const [cities, list] = await Promise.all([companiesStore.cities(state), companiesStore.list(state, null, (pageNo - 1) * PER_PAGE, PER_PAGE)]);
  if (!list.total) return null;
  const nm = stateName(state);
  const path = `${stateHref(state)}${pageNo > 1 ? `?page=${pageNo}` : ''}`;
  const body = `<div class="wrap" style="padding-bottom:56px">
<nav class="crumbs"><a href="/carriers">Carrier directory</a> › ${esc(nm)}</nav>
<h1>Trucking companies in ${esc(nm)}</h1>
<p class="lead">${list.total.toLocaleString('en-US')} carriers and freight brokers based in ${esc(nm)} with an active USDOT number and MC authority.</p>
${pageNo === 1 ? `<h2 style="margin-top:28px">Cities</h2><ul class="cityl">${cities.slice(0, 300).map((x) => `<li><a href="${cityHref(state, x.city)}">${esc(titleCase(x.city))}</a> <small>${x.n}</small></li>`).join('')}</ul>` : ''}
<h2 style="margin-top:32px">Largest fleets${pageNo > 1 ? ` — page ${pageNo}` : ''}</h2>
${companyList(list.rows)}
${pager(stateHref(state), pageNo, Math.min(list.total, 20 * PER_PAGE))}
</div>`;
  return { status: 200, html: page({ path, title: `Trucking Companies in ${nm} — ${list.total.toLocaleString('en-US')} Carriers & Brokers${pageNo > 1 ? ` (page ${pageNo})` : ''} | HaulPanel`, description: `${list.total.toLocaleString('en-US')} trucking companies and freight brokers in ${nm} with active USDOT and MC numbers, by city: fleet size, MC, USDOT and a live authority check.`, body, jsonLd: [breadcrumbs([['Carrier directory', '/carriers'], [nm, stateHref(state)]])] }) };
}

/** /carriers/<state>/<city> */
export async function cityPage(st: string, citySlug: string, pageNo: number): Promise<{ status: number; html: string } | null> {
  const state = st.toUpperCase();
  if (!STATES[state]) return null;
  const list = await companiesStore.list(state, citySlug, (pageNo - 1) * PER_PAGE, PER_PAGE);
  if (!list.total) return null;
  const city = titleCase(list.rows[0]?.city ?? citySlug.replace(/-/g, ' '));
  const where = `${city}, ${state}`;
  const base = `${stateHref(state)}/${citySlug}`;
  const body = `<div class="wrap" style="padding-bottom:56px">
<nav class="crumbs"><a href="/carriers">Carrier directory</a> › <a href="${stateHref(state)}">${esc(stateName(state))}</a> › ${esc(city)}</nav>
<h1>Trucking companies in ${esc(where)}</h1>
<p class="lead">${list.total.toLocaleString('en-US')} carrier${list.total === 1 ? '' : 's'} and freight broker${list.total === 1 ? '' : 's'} based in ${esc(where)} with an active USDOT number and MC authority, largest fleets first.</p>
${companyList(list.rows)}
${pager(base, pageNo, list.total)}
</div>`;
  return { status: 200, html: page({ path: `${base}${pageNo > 1 ? `?page=${pageNo}` : ''}`, title: `Trucking Companies in ${where} — ${list.total} Carriers & Brokers | HaulPanel`, description: `${list.total} trucking companies and freight brokers in ${where}: MC and USDOT numbers, fleet size and a live authority and insurance check for each.`, body, jsonLd: [breadcrumbs([['Carrier directory', '/carriers'], [stateName(state), stateHref(state)], [city, base]])] }) };
}

function companyList(rows: PublicCompany[]) {
  return `<ul class="list">${rows.map((x) => `<li><span><a href="/mc/${x.mc}">${esc(name(x))}</a>${x.city ? ` <small class="muted">${esc(titleCase(x.city))}</small>` : ''}</span><small>${kindsOf(x).includes('Broker') && !kindsOf(x).includes('Carrier') ? 'Broker · ' : ''}MC ${x.mc}${x.powerUnits ? ` · ${n(x.powerUnits)} truck${x.powerUnits === 1 ? '' : 's'}` : ''}</small></li>`).join('')}</ul>`;
}

function pager(base: string, pageNo: number, total: number) {
  const last = Math.ceil(total / PER_PAGE);
  if (last <= 1) return '';
  return `<div class="pager"><span>${pageNo > 1 ? `<a class="btn" href="${base}${pageNo > 2 ? `?page=${pageNo - 1}` : ''}">← Previous</a>` : ''}</span><span class="muted" style="align-self:center">Page ${pageNo} of ${last}</span><span>${pageNo < last ? `<a class="btn" href="${base}?page=${pageNo + 1}">Next →</a>` : ''}</span></div>`;
}
