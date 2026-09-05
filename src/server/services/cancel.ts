import type { Database } from '@/server/db';
import { type Booking, bookings } from '@/server/db/schema';
import { type CancellableState, transition } from '@/server/domain/booking-state';
import type { Clock } from '@/server/ports/clock';
import { systemClock } from '@/server/ports/clock';
import type { SpreadsheetMirrorPort } from '@/server/ports/spreadsheet-mirror';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { recordAuditEvent } from './audit';
import { removeBookingFromMirror } from './mirror';
import { lapseOpenOffers } from './offers';

export const cancelBookingSchema = z
  .object({
    bookingId: z.string().uuid(),
    // Optional: operators just mark the booking cancelled. Kept for the audit
    // log when given; blank means none.
    reason: z.string().trim().max(1000).optional().nullable(),
  })
  .strict();

export type CancelBookingInput = z.infer<typeof cancelBookingSchema>;

export interface CancelDeps {
  db: Database;
  clock?: Clock;
  mirror?: SpreadsheetMirrorPort;
}

export type CancelResult =
  | { ok: true; booking: Booking }
  | { ok: false; reason: 'validation'; issues: z.ZodIssue[] }
  | { ok: false; reason: 'booking_not_found' }
  | { ok: false; reason: 'wrong_state'; state: string };

/**
 * Move a booking to the `cancelled` state. Permitted from unassigned, assigned,
 * in_progress (see state machine). Records cancelled_at, cancelled_by_operator_id,
 * the optional reason, and the state it came from so the cancel can be undone
 * within the undo window (see undo-cancel.ts).
 */
export async function cancelBooking(
  raw: unknown,
  operatorId: string,
  deps: CancelDeps,
): Promise<CancelResult> {
  const parsed = cancelBookingSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: 'validation', issues: parsed.error.issues };
  }
  const { bookingId } = parsed.data;
  const reason = parsed.data.reason || null;

  const [existing] = await deps.db
    .select()
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);
  if (!existing) return { ok: false, reason: 'booking_not_found' };

  const t = transition(existing.state, { type: 'cancel' });
  if (!t.ok) {
    return { ok: false, reason: 'wrong_state', state: existing.state };
  }

  const now = (deps.clock ?? systemClock).now();
  const [updated] = await deps.db
    .update(bookings)
    .set({
      state: t.next,
      cancelledAt: now,
      cancelledByOperatorId: operatorId,
      cancellationReason: reason,
      stateBeforeCancel: existing.state as CancellableState,
      updatedAt: now,
    })
    .where(and(eq(bookings.id, bookingId), eq(bookings.state, existing.state)))
    .returning();
  if (!updated) {
    return { ok: false, reason: 'wrong_state', state: existing.state };
  }

  await recordAuditEvent(deps.db, {
    actorType: 'operator',
    actorId: operatorId,
    entityType: 'booking',
    entityId: bookingId,
    action: 'cancel',
    before: { state: existing.state },
    after: { state: updated.state, reason },
  });

  // A cancelled booking is no longer on offer to anyone — lapse any open offers
  // so they stop showing as "awaiting" in the console.
  await lapseOpenOffers(deps.db, bookingId, now);

  // Remove the row from the JJ backup sheet — a cancelled job shouldn't linger
  // there looking live (the slim layout has no "cancelled" marker).
  if (deps.mirror) await removeBookingFromMirror(deps.db, deps.mirror, updated, deps.clock);

  return { ok: true, booking: updated };
}
