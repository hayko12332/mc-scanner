import type { CarrierProfile } from '../fmcsa/fmcsa.types.js';

// A quick FMCSA check of a broker (before taking its load) or a carrier (before dispatching it): the warning signs
// a dispatcher looks for on SAFER, as plain flags and one verdict.

export type CheckRole = 'broker' | 'carrier';
export type CheckLevel = 'ok' | 'caution' | 'danger' | 'unknown';

export interface CheckFlag { level: 'caution' | 'danger'; text: string }

export interface CompanyCheck {
  mc: number | null;
  dot: string;
  name: string;
  role: CheckRole;
  level: CheckLevel;
  /** One line for the badge: "Active broker · 6 years", "Authority not active", … */
  summary: string;
  flags: CheckFlag[];
  /** Years since the USDOT number was added, if known. */
  years: number | null;
  /** Insurance (BIPD, $) on file, for carriers. */
  insurance: number | null;
  checkedAt: string;
}

const yearsSince = (iso: string | null, now: Date) =>
  iso ? Math.max(0, (now.getTime() - new Date(iso + 'T12:00:00Z').getTime()) / (365.25 * 86_400_000)) : null;

const ageText = (y: number | null) =>
  y == null ? '' : y < 1 ? `${Math.max(1, Math.round(y * 12))} mo` : `${Math.floor(y)} ${Math.floor(y) === 1 ? 'year' : 'years'}`;

/** The verdict for one FMCSA profile seen as a broker or a carrier. */
export function checkCompany(p: CarrierProfile, role: CheckRole, now = new Date()): CompanyCheck {
  const a = p.authority;
  const flags: CheckFlag[] = [];
  const years = yearsSince(p.addedOn, now);
  const danger = (text: string) => flags.push({ level: 'danger', text });
  const caution = (text: string) => flags.push({ level: 'caution', text });

  if (p.usdotStatus && p.usdotStatus !== 'A') danger('USDOT number is not active');
  if (!a) {
    danger(role === 'broker' ? 'No broker authority on record' : 'No operating authority on record');
  } else if (role === 'broker') {
    if (a.broker === 'P') caution('Broker authority is still pending');
    else if (a.broker !== 'A') danger(a.broker === 'I' ? 'Broker authority is not active' : 'Not a licensed broker (no broker authority)');
    if (a.broker === 'A' && a.bondRequired === 'Y' && a.bondOnFile !== 'Y') danger('No surety bond / trust fund on file');
  } else {
    const active = a.common === 'A' || a.contract === 'A' || a.motusCarrier === 'A';
    const pending = a.common === 'P' || a.contract === 'P' || a.motusCarrier === 'P';
    if (!active) (pending ? caution : danger)(pending ? 'Carrier authority is still pending' : 'Carrier authority is not active');
    if (active && a.bipdRequired && (a.bipdOnFile ?? 0) < a.bipdRequired) danger('Liability insurance on file is below the required amount');
    if (active && a.cargoRequired === 'Y' && a.cargoOnFile !== 'Y') caution('No cargo insurance on file');
  }
  if (a?.pendingRevocations.length) danger('Authority revocation is pending');
  if (years != null && years < 0.5) caution(`New company — registered ${ageText(years)} ago`);
  else if (years != null && years < 1) caution(`Young company — ${ageText(years)} old`);
  if (/unsat/i.test(p.safetyRating)) danger('Unsatisfactory safety rating');
  else if (/cond/i.test(p.safetyRating)) caution('Conditional safety rating');

  const level: CheckLevel = flags.some((f) => f.level === 'danger') ? 'danger' : flags.length ? 'caution' : 'ok';
  const what = role === 'broker' ? 'broker' : 'carrier';
  const summary = level === 'ok'
    ? `Active ${what}${years != null ? ` · ${ageText(years)}` : ''}`
    : flags.find((f) => f.level === level)!.text;
  return {
    mc: p.mc, dot: p.dot, name: p.dbaName || p.legalName, role, level, summary, flags, years: years == null ? null : Math.round(years * 10) / 10,
    insurance: a?.bipdOnFile ?? null, checkedAt: now.toISOString(),
  };
}

/** The profile to judge among the ones an MC lookup returns: the one that holds this MC. */
export function pickProfile(profiles: CarrierProfile[], mc: number): CarrierProfile | null {
  // One MC can sit on several USDOT records (an old inactive one and the current one): judge the active one.
  const own = profiles.filter((p) => p.mcNumbers.includes(mc) || p.mc === mc);
  const pool = own.length ? own : profiles;
  return [...pool].sort((a, b) => Number(b.usdotStatus === 'A') - Number(a.usdotStatus === 'A') || Number(!!b.authority) - Number(!!a.authority))[0] ?? null;
}
