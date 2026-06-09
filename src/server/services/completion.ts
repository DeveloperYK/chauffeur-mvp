import { randomUUID } from 'node:crypto';
import { whatsappWebLink } from '@/lib/whatsapp';
import type { Database } from '@/server/db';
import { type Booking, type Driver, bookings, consumedTokens, drivers } from '@/server/db/schema';
import { transition } from '@/server/domain/booking-state';
import { resolveCompletionTimes } from '@/server/domain/completion-times';
import { completionLinkExpiry } from '@/server/domain/durations';
import { signDriverLink, verifyDriverLink } from '@/server/domain/link-tokens';
import type { Clock } from '@/server/ports/clock';
import { systemClock } from '@/server/ports/clock';
import type { SpreadsheetMirrorPort } from '@/server/ports/spreadsheet-mirror';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { recordAuditEvent } from './audit';
import { mirrorBooking } from './mirror';
import { createShortLink } from './short-links';
import { completionRequestSms } from './sms-templates';

export interface CompletionDeps {
  db: Database;
  clock?: Clock;
  secret: string;
  appUrl: string;
  mirror?: SpreadsheetMirrorPort;
}

/**
 * Sentinel driverId baked into a backfill booking's completion token. A backfill
 * job has no `drivers` row, but the signed link still needs a (UUID) driverId
 * claim — the nil UUID marks "backfill, no internal driver". `submitCompletionForm`
 * recognises it and skips the assigned-driver match.
 */
export const BACKFILL_COMPLETION_DRIVER_ID = '00000000-0000-0000-0000-000000000000';

export type GenerateCompletionLinkResult =
  | {
      ok: true;
      url: string;
      shortUrl: string;
      whatsappUrl: string;
      booking: Booking;
      /** Null for a backfill job (no internal driver row). */
      driver: Driver | null;
    }
  | { ok: false; reason: 'booking_not_found' | 'wrong_state' | 'no_driver' };

export async function generateCompletionLink(
  bookingId: string,
  operatorId: string,
  deps: CompletionDeps,
): Promise<GenerateCompletionLinkResult> {
  const clock = deps.clock ?? systemClock;
  const [booking] = await deps.db
    .select()
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);
  if (!booking) return { ok: false, reason: 'booking_not_found' };
  if (booking.state !== 'awaiting_driver_form') return { ok: false, reason: 'wrong_state' };

  // The link is signed for whoever drove the job and the WhatsApp message goes
  // to them. An internal driver has a `drivers` row; a backfill driver has only
  // the operator-entered phone, and the token carries the nil-UUID sentinel.
  let driver: Driver | null = null;
  let signDriverId: string;
  let whatsappNumber: string;
  if (booking.assignedDriverId) {
    const [row] = await deps.db
      .select()
      .from(drivers)
      .where(eq(drivers.id, booking.assignedDriverId))
      .limit(1);
    if (!row) return { ok: false, reason: 'no_driver' };
    driver = row;
    signDriverId = row.id;
    whatsappNumber = row.whatsappNumber;
  } else if (booking.isBackfill && booking.backfillDriverPhone) {
    signDriverId = BACKFILL_COMPLETION_DRIVER_ID;
    whatsappNumber = booking.backfillDriverPhone;
  } else {
    return { ok: false, reason: 'no_driver' };
  }

  const jti = randomUUID();
  const token = await signDriverLink(deps.secret, {
    jobId: booking.id,
    driverId: signDriverId,
    type: 'completion',
    jti,
    now: clock.now(),
    expiresAt: completionLinkExpiry(booking.pickupAt),
  });

  const appBase = deps.appUrl.replace(/\/+$/, '');
  const url = `${appBase}/j/${token}`;
  // Branded short link for the message (the long signed URL is the destination).
  const shortUrl = `${appBase}/s/${await createShortLink(deps.db, url)}`;
  // The manual WhatsApp message reuses the same formatted body as the SMS.
  const text = completionRequestSms(booking, shortUrl);
  const whatsappUrl = whatsappWebLink(whatsappNumber, text);

  await recordAuditEvent(deps.db, {
    actorType: 'operator',
    actorId: operatorId,
    entityType: 'booking',
    entityId: booking.id,
    action: 'completion_link_generated',
    before: null,
    after: { jti },
  });

  // Link is not auto-texted — the operator sends it explicitly once Twilio is
  // configured; for now they copy/open it directly.
  return { ok: true, url, shortUrl, whatsappUrl, booking, driver };
}

/** "HH:MM" 24h wall-clock time (Europe/London), e.g. "23:05". */
const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Enter a time as HH:MM (24-hour)');

// The driver reports a parking fee plus three wall-clock times. The calendar
// date is inferred from the booking's pickup day in the service (with
// day-rollover), so a job running past midnight resolves correctly.
export const completionFormSchema = z
  .object({
    token: z.string().min(20).max(4096),
    carParkPence: z.coerce.number().int().min(0).max(1_000_00),
    arrivalTime: timeOfDay,
    passengerOnBoardTime: timeOfDay,
    completionTime: timeOfDay,
  })
  .strict();

export type SubmitCompletionResult =
  | { ok: true; booking: Booking }
  | {
      ok: false;
      reason:
        | 'validation'
        | 'times_invalid'
        | 'token_invalid'
        | 'token_expired'
        | 'token_consumed'
        | 'wrong_type'
        | 'booking_not_found'
        | 'wrong_state';
      issues?: z.ZodIssue[];
    };

export async function submitCompletionForm(
  raw: unknown,
  deps: CompletionDeps,
): Promise<SubmitCompletionResult> {
  const parsed = completionFormSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: 'validation', issues: parsed.error.issues };
  }
  const clock = deps.clock ?? systemClock;
  const verified = await verifyDriverLink(deps.secret, parsed.data.token, clock.now());
  if (!verified.ok) {
    if (verified.reason === 'expired') return { ok: false, reason: 'token_expired' };
    return { ok: false, reason: 'token_invalid' };
  }
  const { jobId, driverId, type, jti, exp } = verified.payload;
  if (type !== 'completion') return { ok: false, reason: 'wrong_type' };

  const [existing] = await deps.db
    .select()
    .from(consumedTokens)
    .where(eq(consumedTokens.jti, jti))
    .limit(1);
  if (existing) return { ok: false, reason: 'token_consumed' };

  const [booking] = await deps.db.select().from(bookings).where(eq(bookings.id, jobId)).limit(1);
  if (!booking) return { ok: false, reason: 'booking_not_found' };
  if (booking.state !== 'awaiting_driver_form') return { ok: false, reason: 'wrong_state' };

  // A backfill job has no assigned driver — its completion token carries the nil
  // UUID sentinel instead. For an internal driver, the token's driverId must
  // match the assigned driver.
  const isBackfillSubmit = booking.isBackfill && !booking.assignedDriverId;
  if (isBackfillSubmit) {
    if (driverId !== BACKFILL_COMPLETION_DRIVER_ID) return { ok: false, reason: 'wrong_state' };
  } else if (booking.assignedDriverId !== driverId) {
    return { ok: false, reason: 'wrong_state' };
  }

  const t = transition(booking.state, { type: 'driver_submit_form' });
  if (!t.ok) return { ok: false, reason: 'wrong_state' };

  // Resolve the three wall-clock times against the booking's pickup day (with
  // day-rollover) and derive the waiting minutes that still drive the charge.
  const times = resolveCompletionTimes(booking.pickupAt, parsed.data);
  if (!times.ok) return { ok: false, reason: 'times_invalid' };

  const now = clock.now();
  const [updated] = await deps.db
    .update(bookings)
    .set({
      state: t.next,
      carParkPence: parsed.data.carParkPence,
      arrivalAt: times.arrivalAt,
      passengerOnBoardAt: times.passengerOnBoardAt,
      waitingTimeMinutes: times.waitingTimeMinutes,
      dropoffAt: times.dropoffAt,
      completionSubmittedAt: now,
      updatedAt: now,
    })
    .where(and(eq(bookings.id, booking.id), eq(bookings.state, 'awaiting_driver_form')))
    .returning();
  if (!updated) return { ok: false, reason: 'wrong_state' };

  await deps.db.insert(consumedTokens).values({
    jti,
    expiresAt: new Date(exp * 1000),
  });

  await recordAuditEvent(deps.db, {
    actorType: 'driver',
    // A backfill submit has no internal driver row — don't reference a non-
    // existent driver id in the audit trail.
    actorId: isBackfillSubmit ? null : driverId,
    entityType: 'booking',
    entityId: booking.id,
    action: 'driver_submit_form',
    before: { state: booking.state },
    after: {
      state: updated.state,
      carParkPence: parsed.data.carParkPence,
      arrivalAt: times.arrivalAt.toISOString(),
      passengerOnBoardAt: times.passengerOnBoardAt.toISOString(),
      dropoffAt: times.dropoffAt.toISOString(),
      waitingTimeMinutes: times.waitingTimeMinutes,
    },
  });

  if (deps.mirror) await mirrorBooking(deps.db, deps.mirror, updated);

  return { ok: true, booking: updated };
}

export type ReviewResult =
  | { ok: true; booking: Booking }
  | { ok: false; reason: 'booking_not_found' | 'wrong_state' };

export async function approveBooking(
  bookingId: string,
  operatorId: string,
  deps: CompletionDeps,
): Promise<ReviewResult> {
  return reviewBooking(bookingId, operatorId, 'operator_approve', deps);
}

export async function rejectBooking(
  bookingId: string,
  operatorId: string,
  deps: CompletionDeps,
): Promise<ReviewResult> {
  return reviewBooking(bookingId, operatorId, 'operator_reject', deps);
}

async function reviewBooking(
  bookingId: string,
  operatorId: string,
  event: 'operator_approve' | 'operator_reject',
  deps: CompletionDeps,
): Promise<ReviewResult> {
  const clock = deps.clock ?? systemClock;
  const [booking] = await deps.db
    .select()
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);
  if (!booking) return { ok: false, reason: 'booking_not_found' };

  const t = transition(booking.state, { type: event });
  if (!t.ok) return { ok: false, reason: 'wrong_state' };

  const now = clock.now();
  const patch: Record<string, unknown> = {
    state: t.next,
    updatedAt: now,
  };
  if (event === 'operator_approve') {
    patch.approvedAt = now;
    patch.approvedByOperatorId = operatorId;
  }

  const [updated] = await deps.db
    .update(bookings)
    .set(patch)
    .where(and(eq(bookings.id, booking.id), eq(bookings.state, booking.state)))
    .returning();
  if (!updated) return { ok: false, reason: 'wrong_state' };

  await recordAuditEvent(deps.db, {
    actorType: 'operator',
    actorId: operatorId,
    entityType: 'booking',
    entityId: booking.id,
    action: event,
    before: { state: booking.state },
    after: { state: updated.state },
  });

  if (deps.mirror) await mirrorBooking(deps.db, deps.mirror, updated);

  return { ok: true, booking: updated };
}

// Same fields as the driver completion form, minus the token — the operator is
// authenticated, so no signed link is involved.
export const completeOnBehalfSchema = completionFormSchema.omit({ token: true }).strict();

export type CompleteOnBehalfInput = z.input<typeof completeOnBehalfSchema>;

export type CompleteOnBehalfResult =
  | { ok: true; booking: Booking }
  | { ok: false; reason: 'validation'; issues: z.ZodIssue[] }
  | { ok: false; reason: 'times_invalid' }
  | { ok: false; reason: 'booking_not_found' | 'wrong_state'; state?: string };

/**
 * Operator enters the completion form on the driver's behalf (driver slow /
 * unreachable, numbers taken by phone). The booking goes straight to `completed`
 * — skipping `awaiting_operator_review`, since the operator is the author and
 * has nothing to self-review — and is flagged `completionByOperator`. Same
 * fields and waiting-fee/invoicing maths as the driver form. The driver's own
 * link is harmlessly refused afterwards (state is no longer awaiting_driver_form).
 */
export async function completeFormOnBehalf(
  bookingId: string,
  rawInput: CompleteOnBehalfInput,
  operatorId: string,
  deps: CompletionDeps,
): Promise<CompleteOnBehalfResult> {
  const parsed = completeOnBehalfSchema.safeParse(rawInput);
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

  const t = transition(booking.state, { type: 'operator_complete_form' });
  if (!t.ok) return { ok: false, reason: 'wrong_state', state: booking.state };

  // Same time resolution and waiting-fee maths as the driver form.
  const times = resolveCompletionTimes(booking.pickupAt, parsed.data);
  if (!times.ok) return { ok: false, reason: 'times_invalid' };
  const { carParkPence } = parsed.data;

  const now = clock.now();

  // Atomic gate on awaiting_driver_form so a concurrent driver submit can't be
  // clobbered. The operator implicitly approves their own entry, so approvedAt /
  // approvedByOperatorId are set here too.
  const [updated] = await deps.db
    .update(bookings)
    .set({
      state: t.next,
      carParkPence,
      arrivalAt: times.arrivalAt,
      passengerOnBoardAt: times.passengerOnBoardAt,
      waitingTimeMinutes: times.waitingTimeMinutes,
      dropoffAt: times.dropoffAt,
      completionSubmittedAt: now,
      completionByOperator: true,
      approvedAt: now,
      approvedByOperatorId: operatorId,
      updatedAt: now,
    })
    .where(and(eq(bookings.id, booking.id), eq(bookings.state, 'awaiting_driver_form')))
    .returning();
  if (!updated) return { ok: false, reason: 'wrong_state', state: booking.state };

  await recordAuditEvent(deps.db, {
    actorType: 'operator',
    actorId: operatorId,
    entityType: 'booking',
    entityId: booking.id,
    action: 'operator_completed_form',
    before: { state: booking.state },
    after: {
      state: updated.state,
      carParkPence,
      arrivalAt: times.arrivalAt.toISOString(),
      passengerOnBoardAt: times.passengerOnBoardAt.toISOString(),
      dropoffAt: times.dropoffAt.toISOString(),
      waitingTimeMinutes: times.waitingTimeMinutes,
    },
  });

  if (deps.mirror) await mirrorBooking(deps.db, deps.mirror, updated);

  return { ok: true, booking: updated };
}
