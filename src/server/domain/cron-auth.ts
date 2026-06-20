import { constantTimeEqual } from '@/server/auth/tokens';

export type CronAuthResult = { ok: true } | { ok: false; status: 401 | 503; message: string };

/**
 * Authorize a Vercel Cron invocation of the clock-tick endpoint.
 *
 * Vercel sends the project's `CRON_SECRET` env var as an `Authorization: Bearer
 * <secret>` header on every scheduled call. When no secret is configured we treat
 * the endpoint as disabled (503) so a misconfigured deploy fails loudly rather
 * than exposing an unauthenticated job that mutates booking state. The secret is
 * compared in constant time to avoid leaking it through timing.
 */
export function authorizeCronRequest(
  authHeader: string | null,
  cronSecret: string | undefined,
): CronAuthResult {
  if (!cronSecret) {
    return { ok: false, status: 503, message: 'clock tick disabled' };
  }
  const expected = `Bearer ${cronSecret}`;
  if (!authHeader || !constantTimeEqual(authHeader, expected)) {
    return { ok: false, status: 401, message: 'unauthorized' };
  }
  return { ok: true };
}
