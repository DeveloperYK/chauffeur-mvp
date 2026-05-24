import { middleware } from '@/middleware';
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
});
