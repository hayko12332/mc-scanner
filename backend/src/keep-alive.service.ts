import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { config } from './config.js';

const INTERVAL_MS = 10 * 60_000;

/** Requests our own public /api/health every 10 minutes so the free Render instance never falls asleep. */
@Injectable()
export class KeepAliveService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(KeepAliveService.name);
  private timer?: NodeJS.Timeout;

  onApplicationBootstrap() {
    if (!config.keepAlive || !config.publicUrl) return;
    const url = `${config.publicUrl}/api/health`;
    this.timer = setInterval(() => {
      fetch(url, { signal: AbortSignal.timeout(30_000) })
        .then((res) => res.ok || this.logger.warn(`Keep-alive ping: HTTP ${res.status}`))
        .catch((e: Error) => this.logger.warn(`Keep-alive ping failed: ${e.message}`));
    }, INTERVAL_MS);
    this.timer.unref();
    this.logger.log(`Keep-alive: pinging ${url} every ${INTERVAL_MS / 60_000} min`);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }
}
