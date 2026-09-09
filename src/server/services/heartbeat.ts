import { logger } from '@/lib/logger';

/** Ceiling on the heartbeat call so a slow monitor can never hold up a tick. */
export const HEARTBEAT_TIMEOUT_MS = 5_000;

/**
 * Tell an external heartbeat monitor (Better Stack / Healthchecks.io) that the
 * clock tick just ran. The monitor alerts when pings stop — the only way to
 * notice a cron that has silently died, since nothing errors when it does.
 * Fire-and-forget semantics: no URL means no call, and any failure is logged
 * and returned as `false`, never thrown.
 */
export async function pingHeartbeat(
  url: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (!url) return false;
  if (!/^https?:\/\//i.test(url)) {
    logger.warn('heartbeat URL is not http(s); skipping');
    return false;
  }
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      signal: AbortSignal.timeout(HEARTBEAT_TIMEOUT_MS),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, 'heartbeat ping rejected');
      return false;
    }
    return true;
  } catch (err) {
    logger.warn({ err }, 'heartbeat ping failed');
    return false;
  }
}
