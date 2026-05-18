import { constantTimeEqualHex, generateSessionToken, hashSessionToken } from '@/server/auth/tokens';
import { describe, expect, it } from 'vitest';

describe('tokens', () => {
  it('generates unique base64url tokens', () => {
    const a = generateSessionToken();
    const b = generateSessionToken();
    expect(a).not.toEqual(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThanOrEqual(42);
  });

  it('hashSessionToken is deterministic SHA-256', () => {
    const t = 'fixed-token';
    expect(hashSessionToken(t)).toBe(hashSessionToken(t));
    expect(hashSessionToken(t)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('constantTimeEqualHex compares correctly', () => {
    expect(constantTimeEqualHex('ab12', 'ab12')).toBe(true);
    expect(constantTimeEqualHex('ab12', 'ab13')).toBe(false);
    expect(constantTimeEqualHex('ab12', 'ab1234')).toBe(false);
  });
});
