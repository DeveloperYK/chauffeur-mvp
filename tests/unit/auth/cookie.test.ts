import {
  SESSION_COOKIE_NAME,
  clearedSessionCookie,
  refreshedSessionCookie,
  sessionCookie,
} from '@/server/auth/cookie';
import { SESSION_LIFETIME_MS } from '@/server/auth/session-policy';
import { afterEach, describe, expect, it, vi } from 'vitest';

const NOW = new Date('2026-09-16T10:00:00Z');

describe('auth/cookie', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('refreshedSessionCookie', () => {
    it('keeps the same token value under the session cookie name', () => {
      const c = refreshedSessionCookie('tok-123', NOW);
      expect(c.name).toBe(SESSION_COOKIE_NAME);
      expect(c.value).toBe('tok-123');
    });

    it('moves the expiry to a full lifetime from now (sliding)', () => {
      const c = refreshedSessionCookie('tok-123', NOW);
      expect(c.expires).toEqual(new Date(NOW.getTime() + SESSION_LIFETIME_MS));
    });

    it('is HttpOnly, SameSite=Lax and scoped to the whole site', () => {
      const c = refreshedSessionCookie('tok-123', NOW);
      expect(c.httpOnly).toBe(true);
      expect(c.sameSite).toBe('lax');
      expect(c.path).toBe('/');
    });

    it('is Secure in production and not in development', () => {
      vi.stubEnv('NODE_ENV', 'production');
      expect(refreshedSessionCookie('tok', NOW).secure).toBe(true);
      vi.stubEnv('NODE_ENV', 'development');
      expect(refreshedSessionCookie('tok', NOW).secure).toBe(false);
    });

    it('rejects an empty token', () => {
      expect(() => refreshedSessionCookie('', NOW)).toThrow(/token/i);
    });

    it('rejects a whitespace-only token', () => {
      expect(() => refreshedSessionCookie('   ', NOW)).toThrow(/token/i);
    });
  });

  describe('sessionCookie / clearedSessionCookie', () => {
    it('sessionCookie uses the expiry it is given', () => {
      const exp = new Date('2026-10-01T00:00:00Z');
      expect(sessionCookie('tok', exp).expires).toEqual(exp);
    });

    it('clearedSessionCookie expires immediately with an empty value', () => {
      const c = clearedSessionCookie();
      expect(c.value).toBe('');
      expect(c.maxAge).toBe(0);
    });
  });
});
