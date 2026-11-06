import { BadGatewayException, Injectable } from '@nestjs/common';
import { config } from '../config.js';
import { SaferGate, SaferUnavailableException } from './safer-gate.js';
import { parseSnapshot, type SaferSnapshot } from './safer.parser.js';

const SAFER_URL = 'https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

@Injectable()
export class SaferService {
  private readonly gate = new SaferGate(config.saferRequestsPerSecond);

  async snapshotByMc(mc: number): Promise<SaferSnapshot> {
    return parseSnapshot(await this.fetchPage('MC_MX', mc));
  }

  /** The full SAFER snapshot page, fetched server-side so the viewer needs no US connection. */
  async pageByDot(dot: number): Promise<string> {
    const page = await this.fetchPage('USDOT', dot);
    return page.replace(/(<head[^>]*>)/i, '$1<base href="https://safer.fmcsa.dot.gov/">');
  }

  private async fetchPage(param: 'MC_MX' | 'USDOT', value: number): Promise<string> {
    await this.gate.waitTurn();
    let res: Response;
    try {
      res = await fetch(`${SAFER_URL}&query_param=${param}&query_string=${value}`, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      throw new BadGatewayException(`SAFER unreachable: ${(e as Error).message}`);
    }
    if (res.status === 403) {
      throw new SaferUnavailableException('SAFER is temporarily rate-limiting this server (HTTP 403).', this.gate.banned());
    }
    if (!res.ok) throw new BadGatewayException(`SAFER HTTP ${res.status}`);
    this.gate.succeeded();
    // SAFER serves ISO-8859-1.
    return Buffer.from(await res.arrayBuffer()).toString('latin1');
  }
}
