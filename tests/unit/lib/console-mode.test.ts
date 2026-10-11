import {
  CONSOLE_MODE_COOKIE,
  type ConsoleMode,
  isMobileClient,
  resolveConsoleRoute,
} from '@/lib/console-mode';
import { describe, expect, it } from 'vitest';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';
const IPAD =
  'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function route(
  path: string,
  opts: { mobile?: boolean; mode?: ConsoleMode | null; search?: string } = {},
) {
  return resolveConsoleRoute({
    pathname: path,
    search: new URLSearchParams(opts.search ?? ''),
    isMobile: opts.mobile ?? true,
    cookieMode: opts.mode ?? null,
  });
}

describe('lib/console-mode isMobileClient', () => {
  it('trusts the client hint when the browser sends one', () => {
    expect(isMobileClient({ userAgent: MAC, chUaMobile: '?1' })).toBe(true);
    expect(isMobileClient({ userAgent: IPHONE, chUaMobile: '?0' })).toBe(false);
  });
  it('falls back to the user agent for phones', () => {
    expect(isMobileClient({ userAgent: IPHONE, chUaMobile: null })).toBe(true);
    expect(isMobileClient({ userAgent: ANDROID, chUaMobile: null })).toBe(true);
  });
  it('treats desktops and tablets as the full console', () => {
    expect(isMobileClient({ userAgent: MAC, chUaMobile: null })).toBe(false);
    expect(isMobileClient({ userAgent: IPAD, chUaMobile: null })).toBe(false);
    expect(isMobileClient({ userAgent: null, chUaMobile: null })).toBe(false);
  });
});

describe('lib/console-mode resolveConsoleRoute', () => {
  it('exports the cookie name used by the middleware and the shell', () => {
    expect(CONSOLE_MODE_COOKIE).toBe('console_mode');
  });

  describe('phone without a stored preference', () => {
    it('sends the board to the mobile shell', () => {
      expect(route('/dashboard')).toEqual({ redirectTo: '/m', setMode: null });
    });
    it('keeps the selected day', () => {
      expect(route('/dashboard', { search: 'date=2026-10-13&calMonth=2026-10' })).toEqual({
        redirectTo: '/m?date=2026-10-13',
        setMode: null,
      });
    });
    it('opens a deep-linked booking on its mobile screen', () => {
      expect(route('/dashboard', { search: 'booking=abc-1' })).toEqual({
        redirectTo: '/m/b/abc-1',
        setMode: null,
      });
      expect(route('/dashboard/bookings/abc-1')).toEqual({
        redirectTo: '/m/b/abc-1',
        setMode: null,
      });
    });
    it('opens the create form for ?new=1', () => {
      expect(route('/dashboard', { search: 'new=1' })).toEqual({
        redirectTo: '/m/new',
        setMode: null,
      });
    });
    it('leaves desktop-only pages alone (calendar, drivers, invoicing, simulator)', () => {
      for (const p of [
        '/dashboard/calendar',
        '/dashboard/drivers',
        '/dashboard/invoicing',
        '/dashboard/simulator',
      ]) {
        expect(route(p)).toEqual({ redirectTo: null, setMode: null });
      }
    });
    it('leaves the mobile shell, login and public links alone', () => {
      expect(route('/m')).toEqual({ redirectTo: null, setMode: null });
      expect(route('/m/b/x')).toEqual({ redirectTo: null, setMode: null });
      expect(route('/login')).toEqual({ redirectTo: null, setMode: null });
      expect(route('/j/token')).toEqual({ redirectTo: null, setMode: null });
    });
  });

  describe('phone that chose the full console', () => {
    it('stays on the board', () => {
      expect(route('/dashboard', { mode: 'desktop' })).toEqual({ redirectTo: null, setMode: null });
      expect(route('/dashboard/bookings/abc', { mode: 'desktop' })).toEqual({
        redirectTo: null,
        setMode: null,
      });
    });
  });

  describe('desktop browser', () => {
    it('never redirects, whatever the cookie says', () => {
      expect(route('/dashboard', { mobile: false })).toEqual({ redirectTo: null, setMode: null });
      expect(route('/dashboard', { mobile: false, mode: 'mobile' })).toEqual({
        redirectTo: null,
        setMode: null,
      });
      expect(route('/m', { mobile: false })).toEqual({ redirectTo: null, setMode: null });
    });
  });

  describe('explicit switch via ?console=', () => {
    it('?console=desktop stores the preference and lands on the board without the param', () => {
      expect(route('/m', { search: 'console=desktop' })).toEqual({
        redirectTo: '/dashboard',
        setMode: 'desktop',
      });
      expect(route('/dashboard', { search: 'console=desktop&date=2026-10-13' })).toEqual({
        redirectTo: '/dashboard?date=2026-10-13',
        setMode: 'desktop',
      });
    });
    it('never echoes an attacker-controlled path (open redirect)', () => {
      for (const path of ['//evil.com/', '/\\evil.com', '/https://evil.com', '/members']) {
        expect(route(path, { search: 'console=desktop' })).toEqual({
          redirectTo: '/dashboard',
          setMode: 'desktop',
        });
      }
    });
    it('keeps only known console paths and their query', () => {
      expect(route('/dashboard/bookings/abc', { search: 'console=desktop' })).toEqual({
        redirectTo: '/dashboard/bookings/abc',
        setMode: 'desktop',
      });
      expect(route('/dashboard/calendar', { search: 'console=desktop&date=2026-10-13' })).toEqual({
        redirectTo: '/dashboard/calendar?date=2026-10-13',
        setMode: 'desktop',
      });
      // /m-prefixed paths that are not the shell are not the shell.
      expect(route('/manifest.json', { search: 'console=desktop', mobile: false })).toEqual({
        redirectTo: '/dashboard',
        setMode: 'desktop',
      });
    });
    it('?console=mobile clears the preference and lands on the shell', () => {
      expect(route('/dashboard', { search: 'console=mobile', mode: 'desktop' })).toEqual({
        redirectTo: '/m',
        setMode: 'mobile',
      });
    });
    it('ignores unknown values', () => {
      expect(route('/dashboard', { search: 'console=tv', mobile: false })).toEqual({
        redirectTo: null,
        setMode: null,
      });
    });
  });
});
