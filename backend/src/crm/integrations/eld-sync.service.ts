import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { config } from '../../config.js';
import { db } from '../../db.js';
import { CrmStore } from '../crm.store.js';
import { EldError, readFleet, type EldCredential, type EldProvider, type EldRegion } from './eld.js';
import { IntegrationsStore } from './integrations.store.js';
import { vaultReady } from './vault.js';

/**
 * Keeps connected ELDs fresh: every 2 minutes each connection's vehicles, GPS and HOS clocks are read and saved,
 * so the board's map, the brokers' tracking links and the trucks list show where trucks really are.
 * A token the ELD stops accepting is marked on the Integrations page instead of being retried forever.
 */
@Injectable()
export class EldSyncService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(EldSyncService.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private made?: IntegrationsStore | null;

  /** Made on first use, after the board's own tables are there (its tables point at them). */
  get store(): IntegrationsStore | null {
    if (this.made === undefined) { const pool = db(); this.made = pool ? new IntegrationsStore(pool, new CrmStore(pool).ready) : null; }
    return this.made;
  }

  onApplicationBootstrap() {
    if (!db() || !vaultReady()) return;
    this.timer = setInterval(() => void this.syncAll(), 2 * 60_000);
    this.timer.unref();
    setTimeout(() => void this.syncAll(), 20_000).unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  providers(): EldProvider[] {
    return config.motiveEnabled ? ['samsara', 'motive'] : ['samsara'];
  }

  /** Reads one fleet and saves it. Throws EldError with a message for the dispatcher. */
  async sync(ws: number, c: EldCredential) {
    const fleet = await readFleet(c);
    return { ...(await this.store!.applyFleet(ws, c.provider, fleet.units, fleet.hos)), hos: fleet.hos.length };
  }

  async syncAll() {
    if (this.running || !this.store) return;
    const store = this.store;
    this.running = true;
    try {
      for (const c of await store.allOf(this.providers())) {
        try {
          await this.sync(c.ws, { provider: c.provider as EldProvider, region: c.region as EldRegion, token: c.secret });
        } catch (e) {
          // A bad token is the carrier's to fix; a partner outage just waits for the next round.
          if (e instanceof EldError && e.auth) await store.markError(c.ws, c.provider, e.message);
          else this.logger.warn(`ELD ${c.provider} ws ${c.ws}: ${(e as Error).message}`);
        }
      }
    } catch (e) {
      this.logger.warn(`ELD sync: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
