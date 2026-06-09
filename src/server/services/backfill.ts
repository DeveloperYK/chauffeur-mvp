/**
 * Backfill (subcontractor) driver use-cases.
 *
 * When no internal driver is available the operator hands a booking to a
 * backfill driver sourced from the WhatsApp group. The system records who is
 * covering it (free text — no `drivers` row) and runs the booking through the
 * exact same lifecycle as an internal driver, with `assignedDriverId` null:
 *
 *   unassigned ──(handToBackfill)──► assigned ──(clock)──► in_progress
 *   ──(clock)──► awaiting_driver_form ──(backfill driver submits form)──►
 *   awaiting_operator_review ──(operator approve)──► completed
 *
 * The backfill driver fills out the same completion form via a link sent over
 * WhatsApp (see services/completion). See docs/shaping/backfill-drivers.
 */
import type { Database } from '@/server/db';
import { type Booking, bookings } from '@/server/db/schema';
import { transition } from '@/server/domain/booking-state';
import type { Clock } from '@/server/ports/clock';
import { systemClock } from '@/server/ports/clock';
import type { NotificationPort } from '@/server/ports/notifications';
import type { SpreadsheetMirrorPort } from '@/server/ports/spreadsheet-mirror';
import { and, eq } from 'drizzle-orm';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { z } from 'zod';
import { recordAuditEvent } from './audit';
import { mirrorBooking } from './mirror';
import { assignedSms } from './sms-templates';

export interface BackfillDeps {
  db: Database;
  clock?: Clock;
  notifications: NotificationPort;
  mirror?: SpreadsheetMirrorPort;
}

const phoneSchema = z
  .string()
  .min(7)
  .max(30)
  .refine((v) => parsePhoneNumberFromString(v)?.isValid() ?? false, {
    message:
      'invalid phone number — include the country code with a leading + (e.g. +44 7911 123 456)',
  })
  .transform((v) => {
    const parsed = parsePhoneNumberFromString(v);
    if (!parsed) throw new Error('invalid phone number');
    return parsed.format('E.164');
  });

/** Backfill driver pay, in pence. Required — backfill drivers are paid per job. */
const payPenceSchema = z.coerce
  .number()
  .int('Driver pay must be a whole number of pence')
  .min(1, 'Driver pay is required')
  .max(10_000_00, 'Driver pay cannot exceed £10,000');

export const handToBackfillSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    phone: phoneSchema,
    car: z.string().trim().min(1).max(80),
    payPence: payPenceSchema,
  })
  .strict();

export type HandToBackfillInput = z.input<typeof handToBackfillSchema>;

export type HandToBackfillResult =
  | { ok: true; booking: Booking }
  | { ok: false; reason: 'validation'; issues: z.ZodIssue[] }
  | { ok: false; reason: 'booking_not_found' | 'wrong_state'; state?: string };

/**
 * Hand an unassigned booking to a backfill driver. Records the subcontractor's
 * details, moves the booking to `assigned` (flagged backfill, no driver row),
 * confirms the exec, and mirrors. Mirrors the exec-confirmation behaviour of a
 * normal driver accept — the exec experience is unchanged.
 */
export async function handToBackfill(
  bookingId: string,
  rawInput: HandToBackfillInput,
  operatorId: string,
  deps: BackfillDeps,
): Promise<HandToBackfillResult> {
  const parsed = handToBackfillSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, reason: 'validation', issues: parsed.error.issues };
  }

  const clock = deps.clock ?? systemClock;
  const [booking] = await deps.db
    .select()
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);
  if (!booking) return { ok: false, reason: 'booking_not_found' };

  const t = transition(booking.state, { type: 'backfill_assign' });
  if (!t.ok) return { ok: false, reason: 'wrong_state', state: booking.state };

  const now = clock.now();
  const { name, phone, car, payPence } = parsed.data;

  // Atomic gate on the current state so a concurrent transition can't be
  // clobbered. assignedDriverId stays null — this is not an internal driver.
  const [updated] = await deps.db
    .update(bookings)
    .set({
      state: t.next,
      isBackfill: true,
      backfillDriverName: name,
      backfillDriverPhone: phone,
      backfillDriverPayPence: payPence,
      carForThisJob: car,
      assignedAt: now,
      flaggedAt: null,
      updatedAt: now,
    })
    .where(and(eq(bookings.id, booking.id), eq(bookings.state, 'unassigned')))
    .returning();
  if (!updated) return { ok: false, reason: 'wrong_state', state: booking.state };

  await recordAuditEvent(deps.db, {
    actorType: 'operator',
    actorId: operatorId,
    entityType: 'booking',
    entityId: booking.id,
    action: 'hand_to_backfill',
    before: { state: booking.state },
    after: {
      state: updated.state,
      backfillDriverName: name,
      car,
      backfillDriverPayPence: payPence,
    },
  });

  // Exec confirmation — same template as a normal accept, naming the backfill
  // driver and the car they're bringing.
  await deps.notifications.sendSms({
    to: updated.execMobile,
    body: assignedSms(updated, { name }, car),
  });

  if (deps.mirror) await mirrorBooking(deps.db, deps.mirror, updated);

  return { ok: true, booking: updated };
}

export type UpdateBackfillPayResult =
  | { ok: true; booking: Booking }
  | { ok: false; reason: 'validation'; issues: z.ZodIssue[] }
  | { ok: false; reason: 'booking_not_found' | 'not_backfill' };

/**
 * Update the pay recorded for a backfill driver after handoff (e.g. the rate was
 * agreed or corrected later). Only valid on a booking already flagged backfill —
 * internal drivers are salaried and have no per-job pay.
 */
export async function updateBackfillPay(
  bookingId: string,
  payPence: number,
  operatorId: string,
  deps: BackfillDeps,
): Promise<UpdateBackfillPayResult> {
  const parsed = payPenceSchema.safeParse(payPence);
  if (!parsed.success) {
    return { ok: false, reason: 'validation', issues: parsed.error.issues };
  }

  const clock = deps.clock ?? systemClock;
  const [booking] = await deps.db
    .select()
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);
  if (!booking) return { ok: false, reason: 'booking_not_found' };
  if (!booking.isBackfill) return { ok: false, reason: 'not_backfill' };

  const [updated] = await deps.db
    .update(bookings)
    .set({ backfillDriverPayPence: parsed.data, updatedAt: clock.now() })
    .where(eq(bookings.id, booking.id))
    .returning();
  if (!updated) return { ok: false, reason: 'booking_not_found' };

  await recordAuditEvent(deps.db, {
    actorType: 'operator',
    actorId: operatorId,
    entityType: 'booking',
    entityId: booking.id,
    action: 'update_backfill_pay',
    before: { backfillDriverPayPence: booking.backfillDriverPayPence },
    after: { backfillDriverPayPence: parsed.data },
  });

  if (deps.mirror) await mirrorBooking(deps.db, deps.mirror, updated);

  return { ok: true, booking: updated };
}
