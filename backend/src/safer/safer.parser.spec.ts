import { readFileSync } from 'node:fs';
import { parseSnapshot, type SaferRecord } from './safer.parser.js';

const fixture = (name: string) =>
  readFileSync(new URL(`../../test/fixtures/${name}`, import.meta.url)).toString('latin1');
const record = (name: string) => {
  const snapshot = parseSnapshot(fixture(name));
  expect(snapshot.found).toBe(true);
  return snapshot as SaferRecord;
};

describe('parseSnapshot', () => {
  it('reads an authorized carrier', () => {
    const s = record('safer-mc3-authorized.html');
    expect(s.authorized).toBe(true);
    expect(s.broker).toBe(false);
    expect(s.authorizedFor).toEqual(['Motor Carrier of Property (Except Household Goods)']);
    expect(s.usdotStatus).toBe('ACTIVE');
    expect(s.entityType).toBe('CARRIER/FREIGHT FORWARDER/BROKER');
    expect(s.dot).toBe('2952744');
    expect(s.mcNumbers).toEqual(['MC-3']);
    expect(s.legalName).toBe('HAMILTON REESE AND ASSOCIATES');
    expect(s.phone).toBe('(+13) 137-3712'); // as SAFER prints it in this snapshot
    expect(s.asOf).toBe('11/04/2026');
  });

  it('flags broker authority next to carrier authority', () => {
    const s = record('safer-mc1650101-carrier-broker.html');
    expect(s.authorized).toBe(true);
    expect(s.broker).toBe(true);
    expect(s.mcNumbers).toEqual(['MC-1650101', 'MC-640666']);
    expect(s.dbaName).toBe('WHITE RIVER AUTO TRANSPORT');
  });

  it('rejects an out-of-service carrier', () => {
    const s = record('safer-mc1650736-out-of-service.html');
    expect(s.authorized).toBe(false);
    expect(s.authorityStatus).toBe('OUT-OF-SERVICE');
    expect(s.usdotStatus).toBe('OUT-OF-SERVICE');
    expect(s.outOfServiceDate).toBe('05/23/2026');
  });

  it('reports a missing record', () => {
    expect(parseSnapshot(fixture('safer-not-found.html'))).toEqual({ found: false });
  });
});
