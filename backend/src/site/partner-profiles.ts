import { BUSINESS_PROFILES, START_GUIDE } from './partner-content-business.js';
import { FACTORING_COMPARISON, FACTORING_PROFILES } from './partner-content-factoring.js';
import { FLEET_PROFILES, FUEL_COMPARISON } from './partner-content-fleet.js';
import { LOADBOARD_COMPARISON, LOADBOARD_PROFILES } from './partner-content-loadboards.js';
import type { PartnerCategory } from './partners.js';

// What the company and comparison pages say. Facts come from the companies' own sites (sources listed on each page)
// and were checked on `updated`. Prices change: anything not published by the company says so instead of guessing.

export interface Profile {
  id: string;
  slug: string;
  title: string;
  description: string;
  h1: string;
  lead: string;
  glance: [string, string][];
  features: { h: string; p: string }[];
  pricingTitle?: string;
  pricing: string;
  plans?: { name: string; price: string; what: string }[];
  signup: string[];
  withHaulPanel: string;
  goodToKnow: string[];
  faq: [string, string][];
  sources: string[];
  updated: string;
}

export interface Comparison {
  slug: string;
  category: PartnerCategory | 'start';
  crumb: string;
  title: string;
  description: string;
  h1: string;
  lead: string;
  columns: string[];
  rows: { id?: string; name: string; url?: string; cells: string[] }[];
  sections: { h: string; p: string[] }[];
  withHaulPanel: string;
  faq: [string, string][];
  sources: string[];
  updated: string;
}

export const PROFILES: Record<string, Profile> = Object.fromEntries([...FACTORING_PROFILES, ...LOADBOARD_PROFILES, ...FLEET_PROFILES, ...BUSINESS_PROFILES].map((x) => [x.id, x]));
export const COMPARISONS: Record<string, Comparison> = Object.fromEntries([FACTORING_COMPARISON, LOADBOARD_COMPARISON, FUEL_COMPARISON, START_GUIDE].map((x) => [x.slug, x]));
