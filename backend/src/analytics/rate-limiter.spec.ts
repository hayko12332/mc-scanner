import { describe, expect, it } from 'vitest';
import { RateLimiter } from './rate-limiter.js';

describe('RateLimiter', () => {
  it('allows the budget per window and resets after it', () => {
    let now = 0;
    const r = new RateLimiter(3, 1000, () => now);
    expect(r.take('a', 2)).toBe(true);
    expect(r.take('a', 2)).toBe(false);
    expect(r.take('b', 3)).toBe(true);
    now = 1000;
    expect(r.take('a', 3)).toBe(true);
  });
});
