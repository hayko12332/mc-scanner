const SUFFIX =
  /[\s,.]+(L\.?\s?L\.?\s?C|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|L\.?P|L\.?L\.?P|PLLC|P\.?C)\.?$/;

/** Compare names ignoring case and punctuation: "Acme, Inc." == "ACME INC". */
export const normalizeName = (name: string) => name.toUpperCase().replace(/[^A-Z0-9&]+/g, ' ').trim();

/**
 * Prefix to search a registry by: the name without its legal suffix, so "ACME INC" also finds "Acme, Inc.".
 * SoQL LIKE wildcards in the input are dropped.
 */
export function searchPrefix(name: string): string {
  const s = name.toUpperCase().replace(/[%_]/g, ' ').replace(/\s+/g, ' ').trim();
  const core = s.replace(SUFFIX, '').trim();
  return core.length >= 3 ? core : s;
}
