import { describe, expect, it } from 'vitest';
import type { Authority, CarrierProfile } from '../fmcsa/fmcsa.types.js';
import { checkCompany, pickProfile } from './company-check.js';

const NOW = new Date('2026-11-16T12:00:00Z');
const auth = (a: Partial<Authority> = {}): Authority => ({
  sources: ['Motus'], common: 'N', contract: 'N', broker: 'N', motusCarrier: null, motusAuthorities: [], pendingApplications: [], pendingRevocations: [],
  authorityTypes: [], bipdRequired: null, bipdOnFile: null, cargoRequired: '', cargoOnFile: '', bondRequired: '', bondOnFile: '', ...a,
});
const profile = (p: Partial<CarrierProfile> = {}): CarrierProfile => ({
  mc: 123456, mcNumbers: [123456], dot: '999', legalName: 'ACME LOGISTICS LLC', dbaName: '', phone: '', cellPhone: '', fax: '', email: '',
  usdotStatus: 'A', entityTypes: 'B', operation: '', state: 'TX', powerUnits: null, trucks: null, drivers: null, cdlDrivers: null,
  addedOn: '2018-03-01', officers: [], physicalAddress: '', mailingAddress: '', mileage: null, mileageYear: '', safetyRating: '',
  safetyRatingDate: null, hazmat: false, cargo: [], authority: null, ...p,
} as CarrierProfile);

describe('Broker and carrier checks', () => {
  it('passes an active, bonded broker that has been around', () => {
    const c = checkCompany(profile({ authority: auth({ broker: 'A', bondRequired: 'Y', bondOnFile: 'Y' }) }), 'broker', NOW);
    expect(c.level).toBe('ok');
    expect(c.summary).toBe('Active broker · 8 years');
  });

  it('flags a broker without a bond, a revoked one, and a brand-new one', () => {
    expect(checkCompany(profile({ authority: auth({ broker: 'A', bondRequired: 'Y', bondOnFile: 'N' }) }), 'broker', NOW).summary)
      .toBe('No surety bond / trust fund on file');
    expect(checkCompany(profile({ authority: auth({ broker: 'I' }) }), 'broker', NOW).level).toBe('danger');
    const young = checkCompany(profile({ addedOn: '2026-09-01', authority: auth({ broker: 'A', bondRequired: 'Y', bondOnFile: 'Y' }) }), 'broker', NOW);
    expect(young.level).toBe('caution');
    expect(young.summary).toMatch(/^New company/);
  });

  it('checks a carrier for authority and insurance on file', () => {
    const ok = checkCompany(profile({ authority: auth({ common: 'A', motusCarrier: 'A', bipdRequired: 750000, bipdOnFile: 1000000, cargoRequired: 'Y', cargoOnFile: 'Y' }) }), 'carrier', NOW);
    expect(ok.level).toBe('ok');
    const lapsed = checkCompany(profile({ authority: auth({ common: 'A', motusCarrier: 'A', bipdRequired: 750000, bipdOnFile: 0 }) }), 'carrier', NOW);
    expect(lapsed.summary).toBe('Liability insurance on file is below the required amount');
    expect(checkCompany(profile({ authority: auth({ common: 'A', pendingRevocations: ['common'] }) }), 'carrier', NOW).level).toBe('danger');
    expect(checkCompany(profile({ usdotStatus: 'I', authority: auth({ common: 'A' }) }), 'carrier', NOW).level).toBe('danger');
  });
});

describe('Which record an MC check judges', () => {
  it('takes the active USDOT record when one MC has an old inactive one too', () => {
    const old = profile({ dot: '881036', usdotStatus: 'I' });
    const current = profile({ dot: '2226453', usdotStatus: 'A' });
    expect(pickProfile([old, current], 123456)?.dot).toBe('2226453');
  });
});
