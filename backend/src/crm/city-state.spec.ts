import { describe, expect, it } from 'vitest';
import { cityState, fixOffset, readCsv, rowsToRecords, type TableMap } from './ai-import.js';

describe('cityState', () => {
  it('cleans places from spreadsheets into "City, ST"', () => {
    expect(cityState('FISHERSVILLE, VA 22939')).toBe('Fishersville, VA');
    expect(cityState('LOVELAND CO 80537')).toBe('Loveland, CO');
    expect(cityState('Peru, IL, 61354')).toBe('Peru, IL');
    expect(cityState('Houston, TX 77040')).toBe('Houston, TX');
    expect(cityState('ALLENTOWN, PA 18100')).toBe('Allentown, PA');
    expect(cityState('SALT LAKE CITY UT 84101-1234')).toBe('Salt Lake City, UT');
    expect(cityState('Dallas, TX')).toBe('Dallas, TX');
    expect(cityState('McAllen, tx')).toBe('McAllen, TX');
    expect(cityState('Warehouse 12')).toBe('Warehouse 12');
    expect(cityState('123 Main St')).toBe('123 Main St');
    expect(cityState('')).toBe('');
  });
});

describe('fixOffset', () => {
  const csv = `Date,Company Name,PRO#,ORIGIN,DESTINATION,RATE,BB,
,,,,,,,
10/20/2026,TTS LLC,16482877,"FISHERSVILLE, VA 22939","WILLIS, TX 77318","$2,000",Sergo,
10/23/2026,Time Logistics INC,LD408864,"Houston, TX 77040","Aiken, SC 29801","$2,600",Sergo,"$4,600"
10/29/2026,MCM Transportation,95806,"LOVELAND CO 80537","ALBUQUERQUE NM 87105","$1,600",Sergo,
11/02/2026,DG Global Cargo Inc,T882496,"Red Lion, PA 17356","Altoona, IA 50009","$2,000",Sergo,`;
  const t = { source: '', rows: readCsv(csv) };
  const fields = ['date', 'broker', 'load_number', 'origin', 'destination', 'rate', 'dispatcher'] as const;
  const map = (start: number): TableMap => ({ kind: 'loads', what: '', header_row: 0, date_order: 'MDY', statuses: [], advice: '', columns: fields.map((field, i) => ({ field, column: start + i })) });

  it('moves a map that is one column off back into place, and keeps a right one', () => {
    const r = rowsToRecords(t, map(1), 'x');
    expect(r.loads).toHaveLength(4);
    expect(r.loads[0]).toMatchObject({ date: '2026-10-20', broker: 'TTS LLC', pro: '16482877', origin: 'Fishersville, VA', destination: 'Willis, TX', rate: 2000, dispatcher: 'Sergo' });
    expect(fixOffset(t, map(0))).toEqual(map(0));
  });
});
