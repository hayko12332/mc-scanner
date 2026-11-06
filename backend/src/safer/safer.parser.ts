export interface SaferRecord {
  found: true;
  /** Date SAFER says its data is current as of (MM/DD/YYYY). */
  asOf: string;
  entityType: string;
  usdotStatus: string;
  outOfServiceDate: string;
  authorityStatus: string;
  authorizedFor: string[];
  /** AUTHORIZED FOR a Motor Carrier authority and not out of service. */
  authorized: boolean;
  broker: boolean;
  dot: string;
  mcNumbers: string[];
  legalName: string;
  dbaName: string;
  phone: string;
  physicalAddress: string;
  mailingAddress: string;
  mcs150Date: string;
  powerUnits: string;
  drivers: string;
}
export type SaferSnapshot = SaferRecord | { found: false };

// Label cell followed by its value cell; the label may not span another <th> (SAFER nests tables).
const PAIR_RE = /<th[^>]*>((?:(?!<th)[\s\S])*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/gi;
const AS_OF_RE = /as of\s*(?:<[^>]+>\s*)*(\d\d\/\d\d\/\d{4})/i;
const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const cp = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return String.fromCodePoint(cp);
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** HTML fragment -> plain text, keeping <br> as line breaks. */
function clean(fragment: string): string {
  const text = decodeEntities(fragment.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/ /g, ' ');
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t\r\f\v]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

const firstLine = (value = '') => value.split('\n')[0];

export function parseSnapshot(page: string): SaferSnapshot {
  if (page.includes('Record Not Found') || page.includes('Record Inactive')) return { found: false };
  const html = page.replace(/<!--[\s\S]*?-->/g, '');
  const fields: Record<string, string> = {};
  for (const [, label, value] of html.matchAll(PAIR_RE)) {
    const key = clean(label).replace(/:$/, '').trim();
    if (key && !(key in fields)) fields[key] = clean(value);
  }

  const authLines = (fields['Operating Authority Status'] ?? '')
    .split('\n')
    .filter((l) => !l.startsWith('For Licensing') && l !== 'click here.');
  const authorityStatus = authLines[0] ?? '';
  const authorizedFor = authorityStatus.startsWith('AUTHORIZED FOR')
    ? authLines.slice(1).flatMap((l) => l.split(',').map((a) => a.trim()).filter(Boolean))
    : [];
  const usdotStatus = firstLine(fields['USDOT Status']);

  return {
    found: true,
    asOf: AS_OF_RE.exec(page)?.[1] ?? '',
    entityType: firstLine(fields['Entity Type']),
    usdotStatus,
    outOfServiceDate: fields['Out of Service Date'] ?? '',
    authorityStatus,
    authorizedFor,
    authorized:
      authorityStatus.startsWith('AUTHORIZED FOR') &&
      authorizedFor.some((a) => a.startsWith('Motor Carrier')) &&
      !usdotStatus.includes('OUT-OF-SERVICE'),
    broker: authorizedFor.some((a) => a.startsWith('Broker')),
    dot: firstLine(fields['USDOT Number']),
    mcNumbers: (fields['MC/MX/FF Number(s)'] ?? '').match(/MC-\d+/g) ?? [],
    legalName: fields['Legal Name'] ?? '',
    dbaName: fields['DBA Name'] ?? '',
    phone: fields['Phone'] ?? '',
    physicalAddress: (fields['Physical Address'] ?? '').replace(/\n/g, ', '),
    mailingAddress: (fields['Mailing Address'] ?? '').replace(/\n/g, ', '),
    mcs150Date: fields['MCS-150 Form Date'] ?? '',
    powerUnits: fields['Power Units'] ?? '',
    drivers: fields['Drivers'] ?? '',
  };
}
