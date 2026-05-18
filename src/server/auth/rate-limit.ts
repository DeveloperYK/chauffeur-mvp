// In-memory rate limiter — leaky-bucket style. MVP-only.
// Replace with Redis when we go multi-instance.

export interface RateLimitConfig {
  capacity: number; // max attempts per window
  refillIntervalMs: number; // sliding window
  baseLockoutMs: number; // lockout grows exponentially with consecutive blocks
  maxLockoutMs: number;
}

export const DEFAULT_LOGIN_LIMIT: RateLimitConfig = {
  capacity: 5,
  refillIntervalMs: 60_000,
  baseLockoutMs: 30_000,
  maxLockoutMs: 15 * 60_000,
};

interface Bucket {
  tokens: number;
  lastRefillAt: number;
  consecutiveBlocks: number;
  blockedUntilAt: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  constructor(private readonly cfg: RateLimitConfig = DEFAULT_LOGIN_LIMIT) {}

  /** Returns `true` if the request is allowed; `false` (and updates lockout) otherwise. */
  tryConsume(key: string, now: number = Date.now()): boolean {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = {
        tokens: this.cfg.capacity,
        lastRefillAt: now,
        consecutiveBlocks: 0,
        blockedUntilAt: 0,
      };
      this.buckets.set(key, bucket);
    }

    if (now < bucket.blockedUntilAt) return false;

    const elapsed = now - bucket.lastRefillAt;
    if (elapsed > 0) {
      const refill = (elapsed / this.cfg.refillIntervalMs) * this.cfg.capacity;
      bucket.tokens = Math.min(this.cfg.capacity, bucket.tokens + refill);
      bucket.lastRefillAt = now;
    }

    if (bucket.tokens < 1) {
      bucket.consecutiveBlocks += 1;
      const lockout = Math.min(
        this.cfg.maxLockoutMs,
        this.cfg.baseLockoutMs * 2 ** (bucket.consecutiveBlocks - 1),
      );
      bucket.blockedUntilAt = now + lockout;
      return false;
    }

    bucket.tokens -= 1;
    bucket.consecutiveBlocks = 0;
    return true;
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }
}

export const loginRateLimiter = new RateLimiter();
