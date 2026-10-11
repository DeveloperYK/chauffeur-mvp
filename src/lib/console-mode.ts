/**
 * Which console a request should land on: the full operator console
 * (`/dashboard`, built for a desk) or the mobile shell (`/m`, built for an
 * operator who is out and has to handle a booking from their phone).
 *
 * The decision is made in the middleware from the request alone (no DB):
 *   - phones go to the shell unless they have opted into the full console;
 *   - desktops are never redirected (the shell stays reachable by URL);
 *   - `?console=desktop` / `?console=mobile` switch explicitly and persist the
 *     choice in a cookie, so an operator who wants the full console on their
 *     phone is not bounced back every visit.
 *
 * See docs/adr/0018-mobile-shell.md.
 */

export const CONSOLE_MODE_COOKIE = 'console_mode';
/** Query param that switches console explicitly, e.g. `/dashboard?console=desktop`. */
export const CONSOLE_SWITCH_PARAM = 'console';
export type ConsoleMode = 'desktop' | 'mobile';

export const MOBILE_HOME = '/m';
export const DESKTOP_HOME = '/dashboard';

// Phones only. iPads report "iPad" (or a Mac UA with touch) and get the full
// console: the board is usable at tablet width.
const MOBILE_UA = /iPhone|iPod|Android.*Mobile|Windows Phone|Mobi/i;
// Safari on iPad still says "Mobile/15E148" in its UA; the iPad token wins.
const TABLET_UA = /iPad/i;

export function isMobileClient(input: {
  userAgent: string | null;
  /** The `sec-ch-ua-mobile` client hint: "?1" on phones, "?0" otherwise. */
  chUaMobile: string | null;
}): boolean {
  if (input.chUaMobile === '?1') return true;
  if (input.chUaMobile === '?0') return false;
  if (!input.userAgent || TABLET_UA.test(input.userAgent)) return false;
  return MOBILE_UA.test(input.userAgent);
}

export interface ConsoleRouteInput {
  pathname: string;
  search: URLSearchParams;
  isMobile: boolean;
  cookieMode: ConsoleMode | null;
}

export interface ConsoleRouteDecision {
  /** Where to send the request, or null to serve it as is. */
  redirectTo: string | null;
  /** Preference to persist ('desktop' sets the cookie, 'mobile' clears it). */
  setMode: ConsoleMode | null;
}

const NO_CHANGE: ConsoleRouteDecision = { redirectTo: null, setMode: null };

function parseMode(value: string | null): ConsoleMode | null {
  return value === 'desktop' || value === 'mobile' ? value : null;
}

// Paths the full console actually serves. The switch redirect only ever lands
// on one of these: echoing the request path back would let `//evil.com/?console=
// desktop` (or `/\\evil.com`) resolve off-site — an open redirect on our domain.
const DESKTOP_PATH =
  /^\/dashboard(?:\/(?:bookings\/[A-Za-z0-9-]+|calendar|drivers|invoicing|simulator))?$/;

/** The full-console page for a switch request: the same page if it is one, else the board. */
function desktopTarget(pathname: string, search: URLSearchParams): string {
  if (!DESKTOP_PATH.test(pathname)) return DESKTOP_HOME;
  const rest = new URLSearchParams(search);
  rest.delete(CONSOLE_SWITCH_PARAM);
  const qs = rest.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

/** Map a board URL onto the equivalent mobile-shell URL. */
function mobileEquivalent(pathname: string, search: URLSearchParams): string | null {
  const bookingPage = /^\/dashboard\/bookings\/([^/]+)$/.exec(pathname);
  if (bookingPage?.[1]) return `${MOBILE_HOME}/b/${encodeURIComponent(bookingPage[1])}`;
  if (pathname !== DESKTOP_HOME) return null;
  const booking = search.get('booking');
  if (booking) return `${MOBILE_HOME}/b/${encodeURIComponent(booking)}`;
  if (search.get('new') === '1') return `${MOBILE_HOME}/new`;
  const date = search.get('date');
  return date ? `${MOBILE_HOME}?date=${encodeURIComponent(date)}` : MOBILE_HOME;
}

export function resolveConsoleRoute(input: ConsoleRouteInput): ConsoleRouteDecision {
  const requested = parseMode(input.search.get(CONSOLE_SWITCH_PARAM));
  if (requested === 'desktop') {
    return { redirectTo: desktopTarget(input.pathname, input.search), setMode: 'desktop' };
  }
  if (requested === 'mobile') return { redirectTo: MOBILE_HOME, setMode: 'mobile' };

  if (!input.isMobile || input.cookieMode === 'desktop') return NO_CHANGE;
  const target = mobileEquivalent(input.pathname, input.search);
  return target ? { redirectTo: target, setMode: null } : NO_CHANGE;
}
