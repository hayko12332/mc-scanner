import Anthropic from '@anthropic-ai/sdk';
import { deflateRawSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { setAiClient } from './ai.js';
import { buildPlan, explain, fileKind, planImport, readCsv, readXlsx, rowsToRecords, toDate } from './ai-import.js';

/** A minimal .xlsx (ZIP) with deflated parts, the way Excel writes them. */
function xlsx(sheets: { name: string; rows: (string | number)[][] }[]): Buffer {
  const strings: string[] = [];
  const si = (s: string) => { let i = strings.indexOf(s); if (i < 0) { strings.push(s); i = strings.length - 1; } return i; };
  const colName = (i: number) => String.fromCharCode(65 + i);
  const parts: [string, string][] = [
    ['xl/workbook.xml', `<workbook><sheets>${sheets.map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<Relationships>${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`],
    ...sheets.map((s, n): [string, string] => [`xl/worksheets/sheet${n + 1}.xml`, `<worksheet><sheetData>${s.rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) =>
      typeof v === 'number' ? `<c r="${colName(ci)}${ri + 1}"><v>${v}</v></c>` : `<c r="${colName(ci)}${ri + 1}" t="s"><v>${si(v)}</v></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`]),
  ];
  parts.push(['xl/sharedStrings.xml', `<sst>${strings.map((s) => `<si><t>${s.replace(/&/g, '&amp;')}</t></si>`).join('')}</sst>`]);
  const locals: Buffer[] = [], centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, body] of parts) {
    const data = deflateRawSync(Buffer.from(body)), n = Buffer.from(name);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(data.length, 18); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(data.length, 20); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, n, data); centrals.push(ch, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(parts.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

afterEach(() => setAiClient(null));

describe('reading files', () => {
  it('reads every sheet of an Excel file, numbers and text', () => {
    const t = readXlsx(xlsx([{ name: 'Loads', rows: [['Date', 'Broker', 'Rate'], [46340, 'TQL & Co', 2400]] }, { name: 'Trucks', rows: [['Unit', 'Driver'], ['101', 'Arman K.']] }]));
    expect(t).toEqual([
      { source: 'Loads', rows: [['Date', 'Broker', 'Rate'], ['46340', 'TQL & Co', '2400']] },
      { source: 'Trucks', rows: [['Unit', 'Driver'], ['101', 'Arman K.']] },
    ]);
    expect(fileKind('x.xlsx', xlsx([{ name: 'A', rows: [['a']] }]))).toBe('xlsx');
  });

  it('reads CSV with quotes, commas and line breaks inside quotes; and tab-separated text', () => {
    expect(readCsv('Broker,Notes,Rate\r\n"Coyote, Inc","2 stops\nappt 8am",$1,650\n')).toEqual([['Broker', 'Notes', 'Rate'], ['Coyote, Inc', '2 stops\nappt 8am', '$1', '650']]);
    expect(readCsv('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('understands the usual date formats', () => {
    expect(toDate('11/14/2026')).toBe('2026-11-14');
    expect(toDate('14.11.26', 'DMY')).toBe('2026-11-14');
    expect(toDate('2026-11-14')).toBe('2026-11-14');
    expect(toDate('Nov 14th, 2026')).toBe('2026-11-14');
    expect(toDate('46340')).toBe('2026-11-14'); // Excel day number
    expect(toDate('13/45/2026')).toBeNull();
    expect(toDate('')).toBeNull();
  });
});

describe('turning rows into a plan', () => {
  const map = {
    kind: 'loads' as const, what: 'Load log', header_row: 0, date_order: 'MDY' as const,
    columns: [{ field: 'date', column: 0 }, { field: 'broker', column: 1 }, { field: 'origin_city', column: 2 }, { field: 'origin_state', column: 3 },
      { field: 'destination', column: 4 }, { field: 'rate', column: 5 }, { field: 'carrier', column: 6 }, { field: 'truck', column: 7 }, { field: 'driver', column: 8 },
      { field: 'status', column: 9 }, { field: 'load_number', column: 10 }] as { field: 'date'; column: number }[],
    statuses: [{ value: 'Paid', status: 'paid' as const }, { value: 'Picked up', status: 'in_transit' as const }], advice: '',
  };
  const table = { source: '', rows: [
    ['Date', 'Broker', 'From', 'ST', 'To', 'Rate', 'Carrier', 'Truck', 'Driver', 'Status', 'Load #'],
    ['11/10/2026', 'TQL', 'Dallas', 'tx', 'Atlanta, GA', '$2,400.00', 'Beku LLC', '#101', 'Arman K.', 'Paid', 'T-1'],
    ['11/12/2026', 'RXO', 'Ontario', 'CA', 'Phoenix, AZ', '1850', 'Beku LLC', '102', '', 'Picked up', 'R-9'],
    ['', 'total', '', '', '', '4250', '', '', '', '', ''],
  ] };

  it('moves every row by the column map; status words, paid dates and drivers come along', () => {
    const r = rowsToRecords(table, map, 'loads.xlsx');
    expect(r.loads).toHaveLength(2); // the totals row has no date
    expect(r.loads[0]).toMatchObject({ date: '2026-11-10', broker: 'TQL', origin: 'Dallas, TX', destination: 'Atlanta, GA', rate: 2400, truck: '101', status: 'paid', pro: 'T-1', invoicedOn: '2026-11-10' });
    expect(r.loads[1]).toMatchObject({ status: 'in_transit', rate: 1850 });
    expect(r.trucks).toEqual([{ unit: '101', driver: 'Arman K.', phone: '', carrier: 'Beku LLC' }]);
  });

  it('adds carriers, trucks and dispatchers named on loads once, and marks what the board already has', () => {
    const r = rowsToRecords(table, map, 'loads.xlsx');
    const plan = buildPlan({
      loads: [{ id: 1, date: '2026-11-10', broker: 'TQL', pro: 'T-1', origin: 'Dallas, TX', destination: 'Atlanta, GA', rate: 2400 } as never],
      carriers: [], trucks: [{ id: 1, unit: '101', driver: 'Arman K.', phone: '', carrierId: null }], dispatchers: [],
    }, [r, r], [{ name: 'loads.xlsx', what: 'Load log', rows: 4 }], []);
    expect(plan.carriers.map((c) => [c.name, c.existing])).toEqual([['Beku LLC', false]]);
    expect(plan.trucks.map((t) => [t.unit, t.existing])).toEqual([['101', true], ['102', false]]);
    expect(plan.loads.map((l) => [l.pro, l.duplicate])).toEqual([['T-1', true], ['R-9', false]]);
    expect(plan.brokers.map((b) => b.name)).toEqual(['TQL', 'RXO']);
  });

  it('asks the low-cost model only for the column map of each sheet, then reads every row itself', async () => {
    const sent: { model: string; messages: { content: string }[] }[] = [];
    const fetch = (async (_u: string, init: { body: string }) => {
      sent.push(JSON.parse(init.body));
      return new Response(JSON.stringify({
        id: 'm', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
        content: [{ type: 'text', text: JSON.stringify(map) }],
      }), { headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof globalThis.fetch;
    setAiClient(new Anthropic({ apiKey: 'test', fetch, maxRetries: 0 }));
    const csv = Buffer.from(table.rows.map((r) => r.map((c) => (c.includes(',') ? `"${c}"` : c)).join(',')).join('\n'));
    const plan = await planImport({ loads: [], carriers: [], trucks: [], dispatchers: [] }, [{ name: 'loads.csv', data: csv }]);
    expect(sent).toHaveLength(1);
    expect(sent[0].model).toBe('claude-haiku-5-5');
    expect(plan.sources).toEqual([{ name: 'loads.csv', what: 'Load log', rows: 3 }]);
    expect(plan.loads).toHaveLength(2);
    expect(plan.skipped).toEqual([]);
  });
});

describe('explaining an import that adds nothing', () => {
  const empty = { loads: [], carriers: [], trucks: [], dispatchers: [] };
  it('says a company name alone is not enough, and what to add instead', () => {
    const plan = buildPlan(empty, [], [{ name: 'w9.pdf', what: 'W-9 of Eternity Logistics', rows: 1 }], []);
    const a = explain({ ...plan, brokers: [{ name: 'Eternity Logistics', mc: '', email: '' }] }, { customers: ['Eternity Logistics'] }, true);
    expect(a).toHaveLength(1);
    expect(a[0].text).toMatch(/only found Eternity Logistics/);
    expect(a[0].text).toMatch(/load tenders or rate confirmations/);
  });
  it('keeps the AI’s own words, and stays quiet when something new will be added', () => {
    const plan = { ...buildPlan(empty, [], [], [{ name: 'x.pdf', reason: 'Invoice' }]), advice: [{ name: 'x.pdf', text: 'This is an invoice.' }] };
    expect(explain(plan, { customers: [] }, false)).toEqual([{ name: 'x.pdf', text: 'This is an invoice.' }]);
    const withCarrier = { ...plan, advice: [], carriers: [{ name: 'Beku LLC', mc: '', dot: '', phone: '', email: '', feePercent: 0, factoring: '' }] };
    expect(explain(withCarrier, { customers: [] }, false)).toEqual([]);
  });
  it('tells when everything is already on the board', () => {
    const plan = buildPlan({ ...empty, carriers: [{ name: 'Beku LLC', mc: '' }] } as never, [{ loads: [], carriers: [{ name: 'Beku LLC', mc: '', dot: '', phone: '', email: '', feePercent: 0, factoring: '' }], trucks: [], dispatchers: [], brokers: [] }], [], []);
    expect(explain(plan, { customers: [] }, false)[0].text).toMatch(/already on your board/);
  });
});
