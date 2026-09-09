import { londonTodayString, parseDayString } from '@/lib/dates';
import type { Database } from '@/server/db';
import { DbTimeoutError, withDbTimeout } from '@/server/db/timeout';
import { sql } from 'drizzle-orm';
import { driverDispatchData, listBookingsForDay, monthlyDayCounts } from './bookings-query';
import { listAllDrivers } from './drivers';
import { listOperators } from './operators';

/**
 * Cheap liveness probe against the database. Returns false instead of
 * throwing so callers (the /api/healthz route) can map failure to a 503
 * without exception control flow.
 */
export async function checkDatabase(db: Database): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

export type BoardPathResult =
  | { ok: true; ms: number }
  | { ok: false; reason: 'timeout' | 'error'; ms: number; message: string };

/** Default budget for the deep check. The board's own guard is 15 s; a probe that
 * needs more than 5 s already means operators are waiting too long. */
export const BOARD_PATH_TIMEOUT_MS = 5_000;

/**
 * Deep readiness probe: runs the same five parallel reads the board render
 * runs, through the same pool, under a budget. This is what an uptime monitor
 * should hit — `checkDatabase` (select 1) stayed green through a 26-hour
 * outage in which every board load timed out (see memory 2026-09-09).
 * Never throws; failure is a value with a reason the monitor can show.
 */
export async function checkBoardPath(
  db: Database,
  opts: {
    today?: string;
    timeoutMs?: number;
    /** The query batch to race against the budget. Defaults to the board's five
     * reads; injectable so a hang can be simulated deterministically in tests. */
    work?: () => Promise<unknown>;
  } = {},
): Promise<BoardPathResult> {
  const started = Date.now();
  const today = opts.today ?? londonTodayString();
  if (!parseDayString(today)) {
    return { ok: false, reason: 'error', ms: 0, message: `invalid day: ${today}` };
  }
  const month = today.slice(0, 7);
  const timeoutMs = opts.timeoutMs ?? BOARD_PATH_TIMEOUT_MS;
  try {
    const work =
      opts.work ??
      (() =>
        Promise.all([
          listBookingsForDay(db, today),
          monthlyDayCounts(db, month),
          listAllDrivers(db),
          listOperators(db),
          driverDispatchData(db),
        ]));
    await withDbTimeout('readiness board path', timeoutMs, work);
    return { ok: true, ms: Date.now() - started };
  } catch (err) {
    const ms = Date.now() - started;
    if (err instanceof DbTimeoutError) {
      return { ok: false, reason: 'timeout', ms, message: err.message };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: 'error', ms, message };
  }
}
