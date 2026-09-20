import { SESSION_LIFETIME_MS, SESSION_REFRESH_THRESHOLD_MS } from '@/server/auth/session-policy';
import { describe, expect, it } from 'vitest';

describe('auth/session-policy', () => {
  it('sessions live for 14 days', () => {
    expect(SESSION_LIFETIME_MS).toBe(14 * 24 * 60 * 60 * 1000);
  });

  it('server-side refresh kicks in after 7 days', () => {
    expect(SESSION_REFRESH_THRESHOLD_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('refresh threshold is shorter than the lifetime', () => {
    expect(SESSION_REFRESH_THRESHOLD_MS).toBeLessThan(SESSION_LIFETIME_MS);
  });
});
