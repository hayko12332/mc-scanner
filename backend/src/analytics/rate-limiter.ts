/** Fixed-window counter per key, kept in memory (one server instance). */
export class RateLimiter {
  private readonly windows = new Map<string, { start: number; used: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Try to use `amount` from the key's budget; false if that would exceed the limit. */
  take(key: string, amount = 1): boolean {
    const now = this.now();
    let w = this.windows.get(key);
    if (!w || now - w.start >= this.windowMs) {
      w = { start: now, used: 0 };
      this.windows.set(key, w);
      if (this.windows.size > 10_000) this.prune(now);
    }
    if (w.used + amount > this.limit) return false;
    w.used += amount;
    return true;
  }

  private prune(now: number) {
    for (const [key, w] of this.windows) if (now - w.start >= this.windowMs) this.windows.delete(key);
  }
}
