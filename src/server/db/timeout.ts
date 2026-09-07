import { logger } from '@/lib/logger';

/**
 * Client-side ceilings on database work, in milliseconds. Vercel only gives up
 * on a hung function after 300 s; a wedged connection pool would otherwise
 * leave the operator staring at "Creating…" for five minutes. Both values sit
 * well inside the route's `maxDuration` so the guard, not Vercel, fires first.
 * See docs/adr/0014-db-fail-fast.md.
 */
export const DB_TIMEOUT_MS = {
  /** Rendering the board (several parallel reads). */
  page: 15_000,
  /** A server action that writes (create / edit) and mirrors to the sheet. */
  action: 20_000,
} as const;

/**
 * Shown to the operator when the database did not answer in time. The write
 * may or may not have landed, so they are told to look before retrying.
 */
export const DB_TIMEOUT_USER_MESSAGE =
  'The server took too long to respond. Check the board for this booking before trying again.';

export class DbTimeoutError extends Error {
  constructor(
    public readonly label: string,
    public readonly ms: number,
  ) {
    super(`Database work "${label}" did not finish within ${ms} ms`);
    this.name = 'DbTimeoutError';
  }
}

/**
 * Race `work` against a deadline. On the deadline, run `onTimeout` (used to
 * tear down the connection pool so the instance self-heals) and reject with
 * `DbTimeoutError`. A failure inside `onTimeout` is logged and swallowed so
 * the caller always sees the timeout, never the reset's own error.
 */
export async function withDbTimeout<T>(
  label: string,
  ms: number,
  work: () => Promise<T>,
  onTimeout: () => Promise<void> = async () => {},
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(async () => {
      logger.warn({ label, ms }, 'db work timed out — resetting pool');
      try {
        await onTimeout();
      } catch (err) {
        logger.error({ err, label }, 'db pool reset after timeout failed');
      }
      reject(new DbTimeoutError(label, ms));
    }, ms);
  });
  try {
    return await Promise.race([work(), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
