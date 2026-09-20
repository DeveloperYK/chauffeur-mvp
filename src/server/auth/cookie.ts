import type { ResponseCookie } from 'next/dist/compiled/@edge-runtime/cookies';
import { SESSION_LIFETIME_MS } from './session-policy';

export const SESSION_COOKIE_NAME = 'chauffeur_session';

export function sessionCookie(token: string, expiresAt: Date): ResponseCookie {
  return {
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  };
}

export function clearedSessionCookie(): ResponseCookie {
  return {
    name: SESSION_COOKIE_NAME,
    value: '',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: new Date(0),
    maxAge: 0,
  };
}

/**
 * The same session cookie with its expiry pushed a full lifetime out from
 * `now`. The server-side session row slides on validation (see sessions.ts),
 * but a cookie's `Expires` is fixed when it is set, so without this the
 * browser silently drops it 14 days after login — mid-shift — regardless of
 * activity. The middleware re-issues it on every authenticated GET; the DB row
 * stays the authority on whether the token is still valid.
 */
export function refreshedSessionCookie(token: string, now: Date = new Date()): ResponseCookie {
  if (token.trim().length === 0) throw new Error('session token must not be empty');
  return sessionCookie(token, new Date(now.getTime() + SESSION_LIFETIME_MS));
}
