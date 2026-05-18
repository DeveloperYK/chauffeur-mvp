import { describe, expect, it } from 'vitest';

describe('scaffolding sanity', () => {
  it('arithmetic still works', () => {
    expect(1 + 1).toBe(2);
  });

  it('imports the env helper without throwing', async () => {
    const { env } = await import('@/lib/env');
    const e = env();
    expect(e.NODE_ENV).toBeDefined();
  });
});
