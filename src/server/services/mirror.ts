import { logger } from '@/lib/logger';
import type { Database } from '@/server/db';
import { type Booking, type MirrorStatus, bookings, drivers, operators } from '@/server/db/schema';
import { type Clock, systemClock } from '@/server/ports/clock';
import type { SpreadsheetMirrorPort } from '@/server/ports/spreadsheet-mirror';
import { eq } from 'drizzle-orm';
import { recordAuditEvent } from './audit';

/**
 * Record the outcome of a mirror write on the booking so the board can flag a
 * stale backup row. Best-effort: a bookkeeping failure must never take down the
 * operation that triggered the mirror write.
 */
async function recordMirrorOutcome(
  db: Database,
  bookingId: string,
  status: MirrorStatus,
  clock: Clock,
): Promise<void> {
  try {
    await db
      .update(bookings)
      .set({ mirrorStatus: status, mirroredAt: clock.now() })
      .where(eq(bookings.id, bookingId));
  } catch (err) {
    logger.error({ err, bookingId }, 'failed to record mirror status');
  }
}

/** Fire-and-forget write to the spreadsheet mirror. Failures log but never
 * throw — the dashboard must remain available even when the mirror is down.
 * The outcome is cached on the booking (`mirror_status`) so operators can see
 * when the backup sheet is stale. */
export async function mirrorBooking(
  db: Database,
  mirror: SpreadsheetMirrorPort,
  booking: Booking,
  clock: Clock = systemClock,
): Promise<void> {
  let driver = null;
  if (booking.assignedDriverId) {
    const rows = await db
      .select()
      .from(drivers)
      .where(eq(drivers.id, booking.assignedDriverId))
      .limit(1);
    driver = rows[0] ?? null;
  } else if (booking.isBackfill && booking.backfillDriverName) {
    // A backfill job has no `drivers` row — surface the operator-entered
    // subcontractor name in the sheet's Driver Name column so the billing
    // record still shows who covered the trip.
    driver = { name: booking.backfillDriverName } as typeof drivers.$inferSelect;
  }

  let operator = null;
  if (booking.createdByOperatorId) {
    const rows = await db
      .select()
      .from(operators)
      .where(eq(operators.id, booking.createdByOperatorId))
      .limit(1);
    operator = rows[0] ?? null;
  }

  let ok = false;
  try {
    const result = await mirror.upsertRow({ booking, driver, operator });
    ok = result.ok;
    if (!result.ok) {
      logger.warn({ bookingId: booking.id, reason: result.reason }, 'mirror upsert failed');
    }
  } catch (err) {
    logger.error({ err, bookingId: booking.id }, 'mirror threw');
  }
  await recordMirrorOutcome(db, booking.id, ok ? 'ok' : 'failed', clock);
}

/** Fire-and-forget removal of a booking's row from the spreadsheet mirror (e.g.
 * on cancellation, so it doesn't linger in the JJ backup). Failures log but
 * never throw — the dashboard must stay available even when the mirror is down.
 * The outcome is cached on the booking, same as `mirrorBooking`. */
export async function removeBookingFromMirror(
  db: Database,
  mirror: SpreadsheetMirrorPort,
  booking: Booking,
  clock: Clock = systemClock,
): Promise<void> {
  let ok = false;
  try {
    const result = await mirror.deleteRow(booking);
    ok = result.ok;
    if (!result.ok) {
      logger.warn({ bookingId: booking.id, reason: result.reason }, 'mirror delete failed');
    }
  } catch (err) {
    logger.error({ err, bookingId: booking.id }, 'mirror delete threw');
  }
  await recordMirrorOutcome(db, booking.id, ok ? 'ok' : 'failed', clock);
}

export interface RetryMirrorDeps {
  db: Database;
  mirror: SpreadsheetMirrorPort;
  operatorId: string;
  clock?: Clock;
}

export type RetryMirrorResult =
  | { ok: true; status: 'ok' | 'failed' }
  | { ok: false; reason: 'booking_not_found' };

/**
 * Operator-triggered re-run of a booking's mirror write, for clearing a
 * `failed` flag without waiting for the next state change. Re-runs whichever
 * operation the booking's state calls for: cancelled bookings re-attempt the
 * row REMOVAL (so a lingering row is deleted, not resurrected); everything else
 * re-upserts the current row. Safe to repeat — the mirror is keyed by Job #.
 */
export async function retryMirror(
  deps: RetryMirrorDeps,
  bookingId: string,
): Promise<RetryMirrorResult> {
  const clock = deps.clock ?? systemClock;
  const [booking] = await deps.db
    .select()
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);
  if (!booking) return { ok: false, reason: 'booking_not_found' };

  if (booking.state === 'cancelled') {
    await removeBookingFromMirror(deps.db, deps.mirror, booking, clock);
  } else {
    await mirrorBooking(deps.db, deps.mirror, booking, clock);
  }

  const [after] = await deps.db
    .select({ mirrorStatus: bookings.mirrorStatus })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);
  const status = after?.mirrorStatus === 'ok' ? 'ok' : 'failed';

  await recordAuditEvent(deps.db, {
    actorType: 'operator',
    actorId: deps.operatorId,
    entityType: 'booking',
    entityId: bookingId,
    action: 'mirror_retry',
    before: { mirrorStatus: booking.mirrorStatus },
    after: { mirrorStatus: status },
  });

  return { ok: true, status };
}
