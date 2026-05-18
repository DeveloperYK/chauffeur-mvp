import { RateLimiter } from '@/server/auth/rate-limit';
import { describe, expect, it } from 'vitest';

describe('RateLimiter', () => {
  it('allows up to capacity then blocks', () => {
    const rl = new RateLimiter({
      capacity: 3,
      refillIntervalMs: 60_000,
      baseLockoutMs: 1_000,
      maxLockoutMs: 60_000,
    });
    expect(rl.tryConsume('alice', 0)).toBe(true);
    expect(rl.tryConsume('alice', 0)).toBe(true);
    expect(rl.tryConsume('alice', 0)).toBe(true);
    expect(rl.tryConsume('alice', 0)).toBe(false);
  });

  it('refills over time', () => {
    const rl = new RateLimiter({
      capacity: 2,
      refillIntervalMs: 1_000,
      baseLockoutMs: 1_000,
      maxLockoutMs: 60_000,
    });
    expect(rl.tryConsume('alice', 0)).toBe(true);
    expect(rl.tryConsume('alice', 0)).toBe(true);
    expect(rl.tryConsume('alice', 0)).toBe(false);
    // lockout (1s); after 2s we should be able to consume again
    expect(rl.tryConsume('alice', 2_000)).toBe(true);
  });

  it('exponentially backs off on repeated blocks', () => {
    const rl = new RateLimiter({
      capacity: 1,
      refillIntervalMs: 1_000_000,
      baseLockoutMs: 1_000,
      maxLockoutMs: 60_000,
    });
    expect(rl.tryConsume('bob', 0)).toBe(true);
    expect(rl.tryConsume('bob', 0)).toBe(false); // first block: 1000ms
    expect(rl.tryConsume('bob', 999)).toBe(false);
    expect(rl.tryConsume('bob', 1_001)).toBe(false); // still no tokens, second block: 2000ms
    expect(rl.tryConsume('bob', 1_500)).toBe(false);
  });

  it('isolates keys', () => {
    const rl = new RateLimiter({
      capacity: 1,
      refillIntervalMs: 60_000,
      baseLockoutMs: 1_000,
      maxLockoutMs: 60_000,
    });
    expect(rl.tryConsume('alice', 0)).toBe(true);
    expect(rl.tryConsume('alice', 0)).toBe(false);
    expect(rl.tryConsume('bob', 0)).toBe(true);
  });

  it('reset clears the bucket', () => {
    const rl = new RateLimiter({
      capacity: 1,
      refillIntervalMs: 1_000_000,
      baseLockoutMs: 1_000,
      maxLockoutMs: 60_000,
    });
    rl.tryConsume('alice', 0);
    expect(rl.tryConsume('alice', 0)).toBe(false);
    rl.reset('alice');
    expect(rl.tryConsume('alice', 0)).toBe(true);
  });
});
