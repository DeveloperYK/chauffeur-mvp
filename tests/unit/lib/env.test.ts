import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// env() caches at module scope, so each scenario gets a fresh module via
// vi.resetModules() + dynamic import. process.env is snapshotted and restored
// so we never leak a mutation into other test files.
const ORIGINAL_ENV = process.env;

describe('env() — CLOCK_TICK_SECRET validation', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('exposes a valid clock-tick secret', async () => {
    process.env.CLOCK_TICK_SECRET = 'x'.repeat(32);
    const { env } = await import('@/lib/env');
    expect(env().CLOCK_TICK_SECRET).toBe('x'.repeat(32));
  });

  it('is undefined when the secret is unset (clock disabled)', async () => {
    process.env.CLOCK_TICK_SECRET = undefined;
    const { env } = await import('@/lib/env');
    expect(env().CLOCK_TICK_SECRET).toBeUndefined();
  });

  it('rejects a too-short secret at parse time (fail fast)', async () => {
    process.env.CLOCK_TICK_SECRET = 'tooshort';
    const { env } = await import('@/lib/env');
    expect(() => env()).toThrow();
  });
});
