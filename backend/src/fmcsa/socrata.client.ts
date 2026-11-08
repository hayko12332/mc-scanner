import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { config } from '../config.js';

const FMCSA_HOST = 'data.transportation.gov';

/** FMCSA datasets on data.transportation.gov (Socrata), all refreshed daily. */
export const DATASETS = {
  census: 'az4n-8mr2', // Company Census File
  legacyCarrier: '6eyk-hxee', // L&I Carrier - All With History (authority + insurance on file)
  motusCarrier: 'inys-ebih', // Motus Carrier - All With History (current registration system)
  legacyInsurance: 'qh9u-swkp', // L&I ActPendInsur - legacy policies, no new filings since 05/2026
  motusInsurance: 'c5y8-a4uz', // Motus Insur - current active/pending policies
  motusInsuranceHistory: '3uet-3z4i', // Motus InsHist - cancelled/replaced policies
} as const;

export type Row = Record<string, string | undefined>;

/** SoQL `in (...)` list. Values are generated docket/MC strings, never user text. */
export const inList = (values: (string | number)[]) => values.map((v) => `'${v}'`).join(',');

/** SoQL string literal for user-supplied text. */
export const soqlString = (value: string) => `'${value.replace(/'/g, "''")}'`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

@Injectable()
export class SocrataClient {
  private readonly logger = new Logger(SocrataClient.name);

  /** Query a dataset; `host` defaults to FMCSA's portal (several state open-data portals run Socrata too). */
  async query<T = Row>(dataset: string, params: Record<string, string>, host = FMCSA_HOST): Promise<T[]> {
    const url = `https://${host}/resource/${dataset}.json?${new URLSearchParams(params)}`;
    // Socrata app tokens are valid on every Socrata portal.
    const headers: Record<string, string> = config.socrataAppToken ? { 'X-App-Token': config.socrataAppToken } : {};
    let lastError = '';
    for (let attempt = 0; attempt < 5; attempt++) {
      if (attempt) await sleep(Math.min(15_000, 1000 * 2 ** attempt));
      try {
        const res = await fetch(url, { headers, signal: AbortSignal.timeout(60_000) });
        if (res.ok) return (await res.json()) as T[];
        lastError = `HTTP ${res.status}`;
        // 4xx other than throttling means a bad query; retrying won't help.
        if (res.status < 500 && res.status !== 429) break;
      } catch (e) {
        lastError = (e as Error).message;
      }
      this.logger.warn(`${host}/${dataset}: ${lastError} (attempt ${attempt + 1})`);
    }
    throw new BadGatewayException(`Open data ${host} (${dataset}): ${lastError}`);
  }
}
