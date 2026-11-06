import { buildAuthority, summarizeMotus } from './authority.mapper.js';

const legacy = (common: string, contract = 'N', broker = 'N') => ({
  docket_number: 'MC001650',
  common_stat: common,
  contract_stat: contract,
  broker_stat: broker,
  property_chk: 'Y',
  min_cov_amount: '00750',
  bipd_file: '01000',
  cargo_req: 'N',
  cargo_file: 'N',
});
const motus = (status: string, type = 'Motor Carrier of Property (Except Household Goods)') =>
  summarizeMotus([
    { docket_number: 'MC1650', op_auth_type: type, op_auth_status: status, min_cov_amount: '750000.00', bipd_file: '1000000.00' },
  ]).get(1650);

describe('buildAuthority', () => {
  it('converts legacy amounts from thousands of dollars', () => {
    const a = buildAuthority(legacy('A'), undefined, 'strict');
    expect(a).toMatchObject({ sources: ['L&I'], common: 'A', bipdRequired: 750_000, bipdOnFile: 1_000_000 });
    expect(a?.authorityTypes).toEqual(['Property']);
  });

  it('prefers Motus insurance-on-file values when Motus has a carrier record', () => {
    const a = buildAuthority(legacy('A'), motus('Active'), 'strict');
    expect(a).toMatchObject({ sources: ['L&I', 'Motus'], motusCarrier: 'A', bipdOnFile: 1_000_000, bipdRequired: 750_000 });
  });

  it('strict mode drops a carrier when the two systems disagree', () => {
    expect(buildAuthority(legacy('A'), motus('Inactive'), 'strict')).toBeNull();
    expect(buildAuthority(legacy('I'), motus('Active'), 'strict')).toBeNull();
  });

  it('lenient mode keeps it for SAFER to decide', () => {
    expect(buildAuthority(legacy('I'), motus('Active'), 'lenient')).not.toBeNull();
    expect(buildAuthority(legacy('I'), motus('Inactive'), 'lenient')).toBeNull();
  });

  it('drops an MC that neither system knows', () => {
    expect(buildAuthority(undefined, undefined, 'strict')).toBeNull();
    expect(buildAuthority(undefined, undefined, 'lenient')).toBeNull();
  });

  it('treats a Motus broker authority as broker, not carrier', () => {
    const broker = motus('Active', 'Broker of Property (Except Household Goods)');
    expect(broker).toMatchObject({ carrier: null, broker: 'A' });
    expect(buildAuthority(legacy('A'), broker, 'strict')).toMatchObject({ broker: 'A', motusCarrier: null });
  });
});
