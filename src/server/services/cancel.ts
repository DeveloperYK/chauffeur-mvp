import type { Database } from '@/server/db';
import { type Booking, bookings } from '@/server/db/schema';
import { transition } from '@/server/domain/booking-state';
import type { Clock } from '@/server/ports/clock';
import { systemClock } from '@/server/ports/clock';
import type { SpreadsheetMirrorPort } from '@/server/ports/spreadsheet-mirror';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { recordAuditEvent } from './audit';
import { mirrorBooking } from './mirror';
import { lapseOpenOffers } from './offers';

export const cancelBookingSchema = z
  .object({
    bookingId: z.string().uuid(),
    reason: z.string().trim().min(5).max(1000),
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
 * Move a booking to the `cancelled` state with a mandatory operator-supplied
 * reason. Permitted from unassigned, assigned, in_progress (see state
 * machine). Records cancelled_at, cancelled_by_operator_id, and the reason.
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
  const { bookingId, reason } = parsed.data;

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

  if (deps.mirror) await mirrorBooking(deps.db, deps.mirror, updated);

  return { ok: true, booking: updated };
}
