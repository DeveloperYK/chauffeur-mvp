import type { Env } from '@/lib/env';

/**
 * True only in a real, operator-authenticated production deploy.
 *
 * Staging runs `NODE_ENV=production` too, but with `AUTH_DISABLED` set (the
 * login wall is bypassed for testing), so it is deliberately NOT "real
 * production". Dev/test are never real production. Use this to fence off
 * side effects that must touch live systems only — e.g. writing the live
 * Google Sheets backup, which must never receive staging or simulator test
 * records.
 */
export function isRealProduction(e: Pick<Env, 'NODE_ENV' | 'AUTH_DISABLED'>): boolean {
  return e.NODE_ENV === 'production' && !e.AUTH_DISABLED;
}
