import type { Database } from '@/server/db';
import { type Booking, bookings, drivers } from '@/server/db/schema';
import { transition } from '@/server/domain/booking-state';
import {
  DEFAULT_NO_ACCEPT_WINDOW_MS,
  expectedEndAt,
  inProgressDueAt,
} from '@/server/domain/durations';
import type { Clock } from '@/server/ports/clock';
import { systemClock } from '@/server/ports/clock';
import type { NotificationPort } from '@/server/ports/notifications';
import { and, eq, isNull, lte } from 'drizzle-orm';
import { recordAuditEvent } from './audit';
import { enRouteSms } from './sms-templates';

export interface ClockTickDeps {
  db: Database;
  clock?: Clock;
  notifications: NotificationPort;
  noAcceptWindowMs?: number;
}

export interface ClockTickReport {
  assignedToInProgress: string[];
  inProgressToAwaitingDriverForm: string[];
  flaggedUnaccepted: string[];
}

/**
 * Run one pass of the clock service. Idempotent — safe to call once a minute.
 *
 * Each transition uses `SELECT ... FOR UPDATE SKIP LOCKED` semantics
 * conceptually; with our small volume we rely on the atomic UPDATE-WHERE
 * idempotency to make double-runs harmless.
 */
export async function clockTick(deps: ClockTickDeps): Promise<ClockTickReport> {
  const clock = deps.clock ?? systemClock;
  const now = clock.now();
  const noAcceptWindow = deps.noAcceptWindowMs ?? DEFAULT_NO_ACCEPT_WINDOW_MS;

  const report: ClockTickReport = {
    assignedToInProgress: [],
    inProgressToAwaitingDriverForm: [],
    flaggedUnaccepted: [],
  };

  // 1. assigned → in_progress when T-1h reached
  const assigned = await deps.db
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.state, 'assigned'),
        lte(bookings.pickupAt, new Date(now.getTime() + 60 * 60 * 1000)),
      ),
    );

  for (const b of assigned) {
    if (inProgressDueAt(b.pickupAt).getTime() > now.getTime()) continue;
    const t = transition(b.state, { type: 'clock_pickup_minus_1h' });
    if (!t.ok) continue;
    const [updated] = await deps.db
      .update(bookings)
      .set({ state: t.next, updatedAt: now })
      .where(and(eq(bookings.id, b.id), eq(bookings.state, 'assigned')))
      .returning();
    if (!updated) continue;
    report.assignedToInProgress.push(updated.id);

    await recordAuditEvent(deps.db, {
      actorType: 'system',
      actorId: null,
      entityType: 'booking',
      entityId: updated.id,
      action: 'clock_pickup_minus_1h',
      before: { state: 'assigned' },
      after: { state: updated.state },
    });

    if (updated.assignedDriverId) {
      const [driver] = await deps.db
        .select()
        .from(drivers)
        .where(eq(drivers.id, updated.assignedDriverId))
        .limit(1);
      if (driver) {
        await deps.notifications.sendSms({
          to: updated.execMobile,
          body: enRouteSms(updated, driver),
        });
      }
    }
  }

  // 2. in_progress → awaiting_driver_form at T+expected_end
  const inProgress = await deps.db.select().from(bookings).where(eq(bookings.state, 'in_progress'));

  for (const b of inProgress) {
    if (expectedEndAt(b.pickupAt, b.expectedDurationMinutes).getTime() > now.getTime()) continue;
    const t = transition(b.state, { type: 'clock_expected_end' });
    if (!t.ok) continue;
    const [updated] = await deps.db
      .update(bookings)
      .set({ state: t.next, updatedAt: now })
      .where(and(eq(bookings.id, b.id), eq(bookings.state, 'in_progress')))
      .returning();
    if (!updated) continue;
    report.inProgressToAwaitingDriverForm.push(updated.id);
    await recordAuditEvent(deps.db, {
      actorType: 'system',
      actorId: null,
      entityType: 'booking',
      entityId: updated.id,
      action: 'clock_expected_end',
      before: { state: 'in_progress' },
      after: { state: updated.state },
    });
  }

  // 3. flag unaccepted bookings whose 24h window has elapsed
  const cutoff = new Date(now.getTime() - noAcceptWindow);
  const flagged = await deps.db
    .update(bookings)
    .set({ flaggedAt: now, updatedAt: now })
    .where(
      and(
        eq(bookings.state, 'unassigned'),
        isNull(bookings.flaggedAt),
        lte(bookings.createdAt, cutoff),
      ),
    )
    .returning();

  for (const row of flagged) {
    report.flaggedUnaccepted.push(row.id);
    await recordAuditEvent(deps.db, {
      actorType: 'system',
      actorId: null,
      entityType: 'booking',
      entityId: row.id,
      action: 'auto_flag_no_accept',
      before: null,
      after: { flaggedAt: now.toISOString() },
    });
  }

  return report;
}

export type ClockTickableBooking = Booking;
