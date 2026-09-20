import { middleware } from '@/middleware';
import { SESSION_COOKIE_NAME } from '@/server/auth/cookie';
import { SESSION_LIFETIME_MS } from '@/server/auth/session-policy';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function cspFor(url = 'https://example.com/dashboard'): string {
  const res = middleware(new NextRequest(url));
  return res.headers.get('content-security-policy') ?? '';
}

describe('CSP middleware', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('directives present in every environment', () => {
    it('locks default-src, object-src, base-uri, form-action and frame-ancestors', () => {
      const csp = cspFor();
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("base-uri 'self'");
      expect(csp).toContain("form-action 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
    });

    it('allowlists Google Fonts for styles and fonts', () => {
      const csp = cspFor();
      expect(csp).toMatch(/style-src[^;]*'unsafe-inline'/);
      expect(csp).toMatch(/style-src[^;]*https:\/\/fonts\.googleapis\.com/);
      expect(csp).toMatch(/font-src[^;]*https:\/\/fonts\.gstatic\.com/);
    });

    it('allowlists Google Maps/Places for the address autocomplete', () => {
      const csp = cspFor();
      // SDK script (host fallback for non-strict-dynamic browsers).
      expect(csp).toMatch(/script-src[^;]*https:\/\/maps\.googleapis\.com/);
      // XHR origins for the autocomplete requests.
      expect(csp).toMatch(/connect-src[^;]*https:\/\/maps\.googleapis\.com/);
      expect(csp).toMatch(/connect-src[^;]*https:\/\/places\.googleapis\.com/);
      // SDK image assets.
      expect(csp).toMatch(/img-src[^;]*https:\/\/maps\.gstatic\.com/);
    });
  });

  describe('production', () => {
    beforeEach(() => {
      vi.stubEnv('NODE_ENV', 'production');
    });

    it('uses a per-request nonce with strict-dynamic and no unsafe-eval', () => {
      const csp = cspFor();
      expect(csp).toMatch(/script-src[^;]*'nonce-[A-Za-z0-9+/=_-]+'/);
      expect(csp).toMatch(/script-src[^;]*'strict-dynamic'/);
      expect(csp).not.toContain("'unsafe-eval'");
      expect(csp).toContain('upgrade-insecure-requests');
    });

    it('generates a fresh nonce on each request', () => {
      const a = cspFor();
      const b = cspFor();
      const nonceOf = (s: string) => s.match(/'nonce-([^']+)'/)?.[1];
      expect(nonceOf(a)).toBeTruthy();
      expect(nonceOf(a)).not.toBe(nonceOf(b));
    });
  });

  describe('development', () => {
    beforeEach(() => {
      vi.stubEnv('NODE_ENV', 'development');
    });

    it('relaxes script-src for HMR (unsafe-eval) without a nonce', () => {
      const csp = cspFor();
      expect(csp).toContain("'unsafe-eval'");
      expect(csp).not.toContain('upgrade-insecure-requests');
    });
  });

  describe('session cookie refresh (sliding expiry)', () => {
    const URL = 'https://example.com/dashboard';
    const withCookie = (method = 'GET') =>
      new NextRequest(URL, {
        method,
        headers: { cookie: `${SESSION_COOKIE_NAME}=tok-abc; other=1` },
      });
    const setCookie = (res: Response) => res.headers.get('set-cookie') ?? '';

    it('re-issues the session cookie on a GET that carries one', () => {
      const res = middleware(withCookie());
      const sc = setCookie(res);
      expect(sc).toContain(`${SESSION_COOKIE_NAME}=tok-abc`);
      expect(sc).toMatch(/HttpOnly/i);
      expect(sc).toMatch(/SameSite=lax/i);
      expect(sc).toMatch(/Path=\//i);
    });

    it('pushes the cookie expiry a full lifetime into the future', () => {
      const before = Date.now();
      const res = middleware(withCookie());
      const m = setCookie(res).match(/Expires=([^;]+)/i);
      expect(m).toBeTruthy();
      const expires = new Date(m?.[1] ?? '').getTime();
      // Allow a second of slack either side for the Date header's precision.
      expect(expires).toBeGreaterThanOrEqual(before + SESSION_LIFETIME_MS - 1_000);
      expect(expires).toBeLessThanOrEqual(Date.now() + SESSION_LIFETIME_MS + 1_000);
    });

    it('marks the refreshed cookie Secure in production', () => {
      vi.stubEnv('NODE_ENV', 'production');
      expect(setCookie(middleware(withCookie()))).toMatch(/Secure/i);
    });

    it('does not touch the response when the request has no session cookie', () => {
      const res = middleware(new NextRequest(URL, { headers: { cookie: 'other=1' } }));
      expect(res.headers.get('set-cookie')).toBeNull();
    });

    it('does not touch the response on a POST (server actions and the login form)', () => {
      const res = middleware(withCookie('POST'));
      expect(res.headers.get('set-cookie')).toBeNull();
    });

    it('does not re-issue an empty session cookie', () => {
      const res = middleware(
        new NextRequest(URL, { headers: { cookie: `${SESSION_COOKIE_NAME}=` } }),
      );
      expect(res.headers.get('set-cookie')).toBeNull();
    });

    it('still sets the CSP header alongside the refreshed cookie', () => {
      const res = middleware(withCookie());
      expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
    });
  });
});
