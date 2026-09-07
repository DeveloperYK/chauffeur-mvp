import { DB_TIMEOUT_MS, DbTimeoutError, withDbTimeout } from '@/server/db/timeout';
import { describe, expect, it } from 'vitest';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('db/withDbTimeout', () => {
  // ── Happy paths ────────────────────────────────────────────────
  it('resolves with the work result when it finishes in time', async () => {
    const out = await withDbTimeout('fast', 50, async () => 42);
    expect(out).toBe(42);
  });

  it('does not invoke onTimeout when the work finishes in time', async () => {
    let fired = 0;
    await withDbTimeout(
      'fast',
      50,
      async () => 'ok',
      async () => void fired++,
    );
    await sleep(60);
    expect(fired).toBe(0);
  });

  it('propagates the work error unchanged (not as a timeout)', async () => {
    const boom = new Error('boom');
    await expect(
      withDbTimeout('failing', 50, async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
  });

  it('ships production-safe defaults: page and action ceilings well under Vercel’s 300 s', () => {
    expect(DB_TIMEOUT_MS.page).toBeGreaterThan(0);
    expect(DB_TIMEOUT_MS.action).toBeGreaterThan(0);
    expect(DB_TIMEOUT_MS.page).toBeLessThan(60_000);
    expect(DB_TIMEOUT_MS.action).toBeLessThan(60_000);
  });

  // ── Unhappy paths ──────────────────────────────────────────────
  it('rejects with DbTimeoutError once the deadline passes', async () => {
    const p = withDbTimeout('slow', 10, () => sleep(100).then(() => 'late'));
    await expect(p).rejects.toBeInstanceOf(DbTimeoutError);
    await expect(p).rejects.toMatchObject({ label: 'slow', ms: 10 });
  });

  it('runs onTimeout (the pool reset) before rejecting', async () => {
    const order: string[] = [];
    const p = withDbTimeout(
      'slow',
      10,
      () => sleep(100).then(() => 'late'),
      async () => {
        order.push('reset');
      },
    ).catch(() => order.push('rejected'));
    await p;
    expect(order).toEqual(['reset', 'rejected']);
  });

  it('still rejects with DbTimeoutError when onTimeout itself throws', async () => {
    const p = withDbTimeout(
      'slow',
      10,
      () => sleep(100).then(() => 'late'),
      async () => {
        throw new Error('reset failed');
      },
    );
    await expect(p).rejects.toBeInstanceOf(DbTimeoutError);
  });

  it('carries a human-readable message naming the operation', async () => {
    await expect(withDbTimeout('board load', 10, () => sleep(100))).rejects.toThrow(
      /board load.*10 ms/,
    );
  });
});
