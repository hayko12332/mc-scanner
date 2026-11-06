import { HttpException, HttpStatus } from '@nestjs/common';

/** 503 telling the client how long to wait before asking for SAFER again. */
export class SaferUnavailableException extends HttpException {
  constructor(
    message: string,
    readonly retryAfter: number,
  ) {
    super({ statusCode: HttpStatus.SERVICE_UNAVAILABLE, message, retryAfter }, HttpStatus.SERVICE_UNAVAILABLE);
  }
}

const MAX_QUEUE_MS = 60_000;
const BASE_COOLDOWN_MS = 60_000;
const MAX_COOLDOWN_MS = 600_000;

/**
 * Shared by every request: spaces SAFER calls evenly, and after a 403 ban stops calling SAFER
 * for a cooldown (doubling on repeated bans) so the ban can expire instead of being extended.
 */
export class SaferGate {
  private nextSlot = 0;
  private blockedUntil = 0;
  private cooldownMs = BASE_COOLDOWN_MS;
  private readonly intervalMs: number;

  constructor(
    requestsPerSecond: number,
    private readonly now: () => number = Date.now,
  ) {
    this.intervalMs = 1000 / requestsPerSecond;
  }

  /** Resolves when this request may call SAFER; throws while banned or when the queue is too long. */
  async waitTurn(): Promise<void> {
    this.assertNotBlocked();
    const now = this.now();
    const slot = Math.max(now, this.nextSlot);
    if (slot - now > MAX_QUEUE_MS) {
      throw new SaferUnavailableException('Too many SAFER checks queued on the server.', Math.ceil((slot - now) / 1000));
    }
    this.nextSlot = slot + this.intervalMs;
    if (slot > now) await new Promise((resolve) => setTimeout(resolve, slot - now));
    this.assertNotBlocked(); // a ban may have started while we waited
  }

  /** Record a 403 and return the seconds until SAFER may be called again. */
  banned(): number {
    if (this.now() >= this.blockedUntil) {
      // First 403 of this ban; later in-flight 403s keep the same deadline.
      this.blockedUntil = this.now() + this.cooldownMs;
      this.cooldownMs = Math.min(this.cooldownMs * 2, MAX_COOLDOWN_MS);
    }
    return this.secondsLeft();
  }

  succeeded(): void {
    this.cooldownMs = BASE_COOLDOWN_MS;
  }

  private secondsLeft(): number {
    return Math.max(1, Math.ceil((this.blockedUntil - this.now()) / 1000));
  }

  private assertNotBlocked(): void {
    if (this.now() < this.blockedUntil) {
      throw new SaferUnavailableException('SAFER is temporarily rate-limiting this server (HTTP 403).', this.secondsLeft());
    }
  }
}
