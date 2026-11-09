import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { config } from '../config.js';
import { DATASETS, SocrataClient } from './socrata.client.js';

const EVERY_MS = 6 * 3_600_000;

/**
 * Every few hours asks each FMCSA dataset for one row, so a removed or broken source is noticed even when nobody
 * uses the site (failures are reported to the owner by the source monitor inside SocrataClient).
 */
@Injectable()
export class SourceProbeService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SourceProbeService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly socrata: SocrataClient) {}

  onApplicationBootstrap() {
    // Only where someone gets the alerts (production with an owner id).
    if (!config.ownerTelegramId || !config.telegramBotToken) return;
    setTimeout(() => void this.probe(), 60_000).unref();
    this.timer = setInterval(() => void this.probe(), EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async probe(): Promise<string[]> {
    const failed: string[] = [];
    for (const [name, id] of Object.entries(DATASETS)) {
      try {
        await this.socrata.query(id, { $limit: '1' });
      } catch {
        failed.push(name);
      }
    }
    if (failed.length) this.logger.warn(`FMCSA sources failing: ${failed.join(', ')}`);
    return failed;
  }
}
