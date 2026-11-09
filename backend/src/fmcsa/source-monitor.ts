import { Logger } from '@nestjs/common';
import { config } from '../config.js';

/** Re-alert about a source that is still failing at most this often. */
const REALERT_MS = 6 * 3_600_000;

interface State {
  failingSince: number;
  /** When the owner was last told; null = not yet. */
  lastAlert: number | null;
  lastError: string;
}

export interface MonitorOptions {
  send: (text: string) => Promise<unknown>;
  now?: () => number;
}

/**
 * Watches FMCSA open-data sources. When a dataset starts failing (removed, renamed, schema changed, outage) the
 * owner gets a Telegram message, again every few hours while it stays down, and once more when it recovers.
 */
export class SourceMonitor {
  private readonly logger = new Logger(SourceMonitor.name);
  private readonly failing = new Map<string, State>();
  private readonly now: () => number;

  constructor(private readonly o: MonitorOptions) {
    this.now = o.now ?? Date.now;
  }

  /** Datasets that are failing right now, with the last error. */
  status(): Record<string, string> {
    return Object.fromEntries([...this.failing].map(([name, s]) => [name, s.lastError]));
  }

  failed(name: string, error: string) {
    const now = this.now();
    const s: State = this.failing.get(name) ?? { failingSince: now, lastAlert: null, lastError: '' };
    s.lastError = error;
    this.failing.set(name, s);
    if (s.lastAlert !== null && now - s.lastAlert < REALERT_MS) return;
    s.lastAlert = now;
    const since = s.failingSince === now ? '' : ` (failing since ${new Date(s.failingSince).toISOString().slice(0, 16)} UTC)`;
    void this.alert(`⚠️ FMCSA data source not answering: ${name}${since}\nError: ${error}\n`
      + 'The site keeps working on the other sources where it can. If the dataset was removed or renamed, the code needs an update.');
  }

  ok(name: string) {
    const s = this.failing.get(name);
    if (!s) return;
    this.failing.delete(name);
    // Only announce recovery when the owner was told about the failure.
    if (s.lastAlert !== null) void this.alert(`✅ FMCSA data source is back: ${name}`);
  }

  private async alert(text: string) {
    this.logger.warn(text.replace(/\n/g, ' | '));
    try {
      await this.o.send(text);
    } catch (e) {
      this.logger.warn(`Could not send source alert: ${(e as Error).message}`);
    }
  }
}

/** Plain-text Telegram message to the site owner; does nothing when the bot or owner id is not configured. */
async function sendToOwner(text: string) {
  if (!config.telegramBotToken || !config.ownerTelegramId) return;
  const res = await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: config.ownerTelegramId, text, link_preview_options: { is_disabled: true } }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
  if (!data.ok) throw new Error(data.description ?? `HTTP ${res.status}`);
}

/** One monitor for the whole server. */
export const sourceMonitor = new SourceMonitor({ send: sendToOwner });
