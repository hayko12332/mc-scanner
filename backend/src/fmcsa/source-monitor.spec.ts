import { BadGatewayException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { CarriersService } from './carriers.service.js';
import { DATASETS, type Row, type SocrataClient } from './socrata.client.js';
import { SourceMonitor } from './source-monitor.js';

describe('SourceMonitor', () => {
  function monitor() {
    const sent: string[] = [];
    let now = 1_000_000;
    const m = new SourceMonitor({ send: async (t) => void sent.push(t), now: () => now });
    return { m, sent, tick: (ms: number) => (now += ms) };
  }

  it('alerts on the first failure, stays quiet for a while, then reminds', () => {
    const { m, sent, tick } = monitor();
    m.failed('legacyCarrier (6eyk-hxee)', 'HTTP 404');
    m.failed('legacyCarrier (6eyk-hxee)', 'HTTP 404');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('legacyCarrier (6eyk-hxee)');
    expect(sent[0]).toContain('HTTP 404');
    tick(6 * 3_600_000);
    m.failed('legacyCarrier (6eyk-hxee)', 'HTTP 404');
    expect(sent).toHaveLength(2);
    expect(sent[1]).toContain('failing since');
    expect(m.status()).toEqual({ 'legacyCarrier (6eyk-hxee)': 'HTTP 404' });
  });

  it('announces recovery once, and nothing for sources that never failed', () => {
    const { m, sent } = monitor();
    m.ok('census');
    expect(sent).toEqual([]);
    m.failed('census', 'HTTP 503');
    m.ok('census');
    m.ok('census');
    expect(sent).toHaveLength(2);
    expect(sent[1]).toContain('is back: census');
    expect(m.status()).toEqual({});
  });
});

describe('CarriersService.authorities without the legacy L&I file', () => {
  const motusRow: Row = {
    docket_number: 'MC12345678', op_auth_type: 'Motor Carrier of Property (Except Household Goods)', op_auth_status: 'Active',
    min_cov_amount: '750000', bipd_file: '750000', cargo_req: 'N', cargo_file: 'N', bond_req: 'N', bond_file: 'N',
  };
  const fake = (failing: string[]) => ({
    query: async (dataset: string) => {
      if (failing.includes(dataset)) throw new BadGatewayException(`Open data (${dataset}): HTTP 404`);
      return dataset === DATASETS.motusCarrier ? [motusRow] : [];
    },
  }) as unknown as SocrataClient;

  it('keeps working on Motus when the legacy file is gone', async () => {
    const service = new CarriersService(fake([DATASETS.legacyCarrier]));
    const result = await service.authorities([12345678], 'strict');
    expect(result.get(12345678)?.motusCarrier).toBe('A');
  });

  it('fails only when both systems fail', async () => {
    const service = new CarriersService(fake([DATASETS.legacyCarrier, DATASETS.motusCarrier]));
    await expect(service.authorities([12345678], 'strict')).rejects.toThrow('HTTP 404');
  });
});
