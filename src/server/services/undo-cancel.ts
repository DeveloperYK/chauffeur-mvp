import type { Database } from '@/server/db';
import { type Booking, bookings } from '@/server/db/schema';
import { transition } from '@/server/domain/booking-state';
import { canUndoCancel } from '@/server/domain/undo-window';
import type { Clock } from '@/server/ports/clock';
import { systemClock } from '@/server/ports/clock';
import type { SpreadsheetMirrorPort } from '@/server/ports/spreadsheet-mirror';
import { and, eq } from 'drizzle-orm';
import { recordAuditEvent } from './audit';
import { mirrorBooking } from './mirror';

export interface UndoCancelDeps {
  db: Database;
  clock?: Clock;
  mirror?: SpreadsheetMirrorPort;
}

export type UndoCancelResult =
  | { ok: true; booking: Booking }
  | { ok: false; reason: 'booking_not_found' }
  | { ok: false; reason: 'not_cancelled'; state: string }
  | { ok: false; reason: 'too_late' }
  | { ok: false; reason: 'no_prior_state' };

/**
 * Take back a cancel made in error. Only while the undo window is open
 * (server clock vs `cancelledAt`), and only back to the state recorded at
 * cancel time. Clears the cancel fields, audits the reversal, and puts the
 * row back in the backup sheet. Offers lapsed by the cancel stay lapsed — the
 * operator re-dispatches if needed; an accepted driver is still attached.
 */
export async function undoCancel(
  bookingId: string,
  operatorId: string,
  deps: UndoCancelDeps,
): Promise<UndoCancelResult> {
  const [existing] = await deps.db
    .select()
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);
  if (!existing) return { ok: false, reason: 'booking_not_found' };
  if (existing.state !== 'cancelled') {
    return { ok: false, reason: 'not_cancelled', state: existing.state };
  }

  const now = (deps.clock ?? systemClock).now();
  if (!canUndoCancel(existing.cancelledAt, now)) return { ok: false, reason: 'too_late' };

  const to = existing.stateBeforeCancel;
  if (to !== 'unassigned' && to !== 'assigned' && to !== 'in_progress') {
    return { ok: false, reason: 'no_prior_state' };
  }

  const t = transition(existing.state, { type: 'undo_cancel', to });
  if (!t.ok) return { ok: false, reason: 'not_cancelled', state: existing.state };

  const [updated] = await deps.db
    .update(bookings)
    .set({
      state: t.next,
      cancelledAt: null,
      cancelledByOperatorId: null,
      cancellationReason: null,
      stateBeforeCancel: null,
      updatedAt: now,
    })
    .where(and(eq(bookings.id, bookingId), eq(bookings.state, 'cancelled')))
    .returning();
  if (!updated) return { ok: false, reason: 'not_cancelled', state: existing.state };

  await recordAuditEvent(deps.db, {
    actorType: 'operator',
    actorId: operatorId,
    entityType: 'booking',
    entityId: bookingId,
    action: 'undo_cancel',
    before: { state: existing.state },
    after: { state: updated.state },
  });
  // The cancel removed the row from the JJ backup; put it back.
  if (deps.mirror) await mirrorBooking(deps.db, deps.mirror, updated, deps.clock);
  return { ok: true, booking: updated };
}
