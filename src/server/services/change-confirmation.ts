import { randomUUID } from 'node:crypto';
import { whatsappWebLink } from '@/lib/whatsapp';
import type { Database } from '@/server/db';
import { type Booking, type Driver, bookings, drivers } from '@/server/db/schema';
import { dispatchLinkExpiry } from '@/server/domain/durations';
import { signDriverLink, verifyDriverLink } from '@/server/domain/link-tokens';
import type { Clock } from '@/server/ports/clock';
import { systemClock } from '@/server/ports/clock';
import type { EmailPort } from '@/server/ports/email';
import type { NotificationPort } from '@/server/ports/notifications';
import type { SpreadsheetMirrorPort } from '@/server/ports/spreadsheet-mirror';
import { and, eq } from 'drizzle-orm';
import { recordAuditEvent } from './audit';
import { notifyExecOfChange } from './exec-notifications';
import { mirrorBooking } from './mirror';
import { createShortLink } from './short-links';
import { changeSms } from './sms-templates';

/**
 * Best-effort: when a confirmed change was exec-relevant (touched time / pickup /
 * destination), email the exec that the update is confirmed. Email-only and never
 * blocks confirmation — a send problem is recorded as a failed exec notification,
 * not surfaced here. See docs/shaping/mid-flight-changes.
 */
async function maybeEmailExecOfChange(
  deps: { db: Database; notifications?: NotificationPort; email?: EmailPort },
  booking: Booking,
): Promise<void> {
  if (!booking.changeExecRelevant) return;
  if (!deps.notifications || !deps.email) return;
  try {
    await notifyExecOfChange(
      { db: deps.db, notifications: deps.notifications, email: deps.email },
      booking.id,
    );
  } catch {
    // Confirmation already succeeded; an exec-email hiccup must never undo it.
  }
}

// ── Generate a change-confirm link for the assigned driver ───────────────────

export interface ChangeLinkDeps {
  db: Database;
  clock?: Clock;
  secret: string;
  appUrl: string;
}

export type GenerateChangeLinkResult =
  | {
      ok: true;
      url: string;
      /** Branded short link (/s/<code>) used in the WhatsApp message. */
      shortUrl: string;
      /** WhatsApp Web link that pre-fills the change message to the driver. */
      whatsappUrl: string;
      driver: Driver;
    }
  | { ok: false; reason: 'booking_not_found' | 'no_pending_change' | 'no_app_driver' };

/**
 * Mint a one-tap "your booking changed — confirm" link for the booking's
 * assigned (internal) driver and return a WhatsApp deep link the operator sends,
 * mirroring the dispatch flow (side-effect-free beyond the short link + audit).
 *
 * Only valid while a change is `pending`. Backfill/subcontractor jobs have no
 * `drivers` row (`assignedDriverId` is null) — there the operator attests via
 * `confirmChangeOnBehalf` instead, so this returns `no_app_driver`.
 */
export async function generateChangeConfirmLink(
  bookingId: string,
  operatorId: string,
  deps: ChangeLinkDeps,
): Promise<GenerateChangeLinkResult> {
  const clock = deps.clock ?? systemClock;
  const [booking] = await deps.db
    .select()
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);
  if (!booking) return { ok: false, reason: 'booking_not_found' };
  if (booking.changeConfirmationStatus !== 'pending') {
    return { ok: false, reason: 'no_pending_change' };
  }
  if (!booking.assignedDriverId) return { ok: false, reason: 'no_app_driver' };

  const [driver] = await deps.db
    .select()
    .from(drivers)
    .where(eq(drivers.id, booking.assignedDriverId))
    .limit(1);
  if (!driver) return { ok: false, reason: 'no_app_driver' };

  const jti = randomUUID();
  const token = await signDriverLink(deps.secret, {
    jobId: booking.id,
    driverId: driver.id,
    type: 'change_confirm',
    jti,
    now: clock.now(),
    expiresAt: dispatchLinkExpiry(booking.pickupAt),
  });

  const appBase = deps.appUrl.replace(/\/+$/, '');
  const url = `${appBase}/j/${token}`;
  const shortUrl = `${appBase}/s/${await createShortLink(deps.db, url)}`;
  const whatsappUrl = whatsappWebLink(driver.whatsappNumber, changeSms(booking, shortUrl));

  await recordAuditEvent(deps.db, {
    actorType: 'operator',
    actorId: operatorId,
    entityType: 'booking',
    entityId: booking.id,
    action: 'change_link_generated',
    before: null,
    after: { driverId: driver.id, jti },
  });

  return { ok: true, url, shortUrl, whatsappUrl, driver };
}

// ── Preview a change-confirm link (driver-facing /j page) ────────────────────

export interface PreviewChangeDeps {
  db: Database;
  clock?: Clock;
  secret: string;
}

export type PreviewChangeResult =
  | { ok: true; booking: Booking; driver: Driver }
  | {
      ok: false;
      reason:
        | 'token_invalid'
        | 'token_expired'
        | 'booking_not_found'
        | 'driver_not_found'
        | 'no_pending_change';
    };

export async function previewChangeConfirmLink(
  token: string,
  deps: PreviewChangeDeps,
): Promise<PreviewChangeResult> {
  const clock = deps.clock ?? systemClock;
  const verified = await verifyDriverLink(deps.secret, token, clock.now());
  if (!verified.ok) {
    if (verified.reason === 'expired') return { ok: false, reason: 'token_expired' };
    return { ok: false, reason: 'token_invalid' };
  }
  const { jobId, driverId, type } = verified.payload;
  if (type !== 'change_confirm') return { ok: false, reason: 'token_invalid' };

  const [booking] = await deps.db.select().from(bookings).where(eq(bookings.id, jobId)).limit(1);
  if (!booking) return { ok: false, reason: 'booking_not_found' };
  const [driver] = await deps.db.select().from(drivers).where(eq(drivers.id, driverId)).limit(1);
  if (!driver) return { ok: false, reason: 'driver_not_found' };
  if (booking.changeConfirmationStatus !== 'pending') {
    return { ok: false, reason: 'no_pending_change' };
  }
  return { ok: true, booking, driver };
}

// ── Confirm a change ─────────────────────────────────────────────────────────

export type ConfirmChangeResult =
  | { ok: true; booking: Booking }
  | { ok: false; reason: 'booking_not_found' | 'no_pending_change' };

export interface ConfirmChangeOnBehalfDeps {
  db: Database;
  clock?: Clock;
  mirror?: SpreadsheetMirrorPort;
  /** Ports for the auto exec-email on an exec-relevant confirmed change. */
  notifications?: NotificationPort;
  email?: EmailPort;
}

/**
 * Operator attests — after a phone call — that the assigned driver knows and
 * agreed to the changed plan. Clears the `pending` flag, recording who attested
 * and when. Works in any state and for backfill drivers (no app link needed).
 */
export async function confirmChangeOnBehalf(
  bookingId: string,
  operatorId: string,
  deps: ConfirmChangeOnBehalfDeps,
): Promise<ConfirmChangeResult> {
  const [booking] = await deps.db
    .select()
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);
  if (!booking) return { ok: false, reason: 'booking_not_found' };

  const now = (deps.clock ?? systemClock).now();
  // Atomic gate on the pending status so a concurrent driver self-confirm can't
  // be double-applied — whichever lands first wins, the other no-ops.
  const [updated] = await deps.db
    .update(bookings)
    .set({
      changeConfirmationStatus: 'confirmed',
      changeConfirmedMethod: 'operator_attested',
      changeConfirmedAt: now,
      changeConfirmedByOperatorId: operatorId,
      updatedAt: now,
    })
    .where(and(eq(bookings.id, bookingId), eq(bookings.changeConfirmationStatus, 'pending')))
    .returning();
  if (!updated) return { ok: false, reason: 'no_pending_change' };

  await recordAuditEvent(deps.db, {
    actorType: 'operator',
    actorId: operatorId,
    entityType: 'booking',
    entityId: bookingId,
    action: 'change_confirmed',
    before: { changeConfirmationStatus: 'pending' },
    after: { changeConfirmationStatus: 'confirmed', method: 'operator_attested' },
  });

  if (deps.mirror) await mirrorBooking(deps.db, deps.mirror, updated);
  await maybeEmailExecOfChange(deps, updated);

  return { ok: true, booking: updated };
}

export interface ConfirmChangeBySelfDeps {
  db: Database;
  clock?: Clock;
  secret: string;
  mirror?: SpreadsheetMirrorPort;
  /** Ports for the auto exec-email on an exec-relevant confirmed change. */
  notifications?: NotificationPort;
  email?: EmailPort;
}

export type ConfirmChangeBySelfResult =
  | { ok: true; booking: Booking }
  | {
      ok: false;
      reason: 'token_invalid' | 'token_expired' | 'booking_not_found' | 'no_pending_change';
    };

/**
 * Driver self-confirms by tapping their change link. Not one-shot: the status
 * gate (`pending` → `confirmed`) makes a re-tap a harmless no-op, and a fresh
 * change re-flags `pending` so the same link confirms the latest plan.
 */
export async function confirmChangeBySelf(
  token: string,
  deps: ConfirmChangeBySelfDeps,
): Promise<ConfirmChangeBySelfResult> {
  const clock = deps.clock ?? systemClock;
  const verified = await verifyDriverLink(deps.secret, token, clock.now());
  if (!verified.ok) {
    if (verified.reason === 'expired') return { ok: false, reason: 'token_expired' };
    return { ok: false, reason: 'token_invalid' };
  }
  const { jobId, driverId, type } = verified.payload;
  if (type !== 'change_confirm') return { ok: false, reason: 'token_invalid' };

  const [booking] = await deps.db.select().from(bookings).where(eq(bookings.id, jobId)).limit(1);
  if (!booking) return { ok: false, reason: 'booking_not_found' };

  const now = clock.now();
  const [updated] = await deps.db
    .update(bookings)
    .set({
      changeConfirmationStatus: 'confirmed',
      changeConfirmedMethod: 'driver_self',
      changeConfirmedAt: now,
      changeConfirmedByOperatorId: null,
      updatedAt: now,
    })
    .where(and(eq(bookings.id, jobId), eq(bookings.changeConfirmationStatus, 'pending')))
    .returning();
  if (!updated) return { ok: false, reason: 'no_pending_change' };

  await recordAuditEvent(deps.db, {
    actorType: 'driver',
    actorId: driverId,
    entityType: 'booking',
    entityId: jobId,
    action: 'change_confirmed',
    before: { changeConfirmationStatus: 'pending' },
    after: { changeConfirmationStatus: 'confirmed', method: 'driver_self' },
  });

  if (deps.mirror) await mirrorBooking(deps.db, deps.mirror, updated);
  await maybeEmailExecOfChange(deps, updated);

  return { ok: true, booking: updated };
}
