import { randomUUID } from 'node:crypto';
import type { Database } from '@/server/db';
import {
  type Booking,
  type CarType,
  type Driver,
  bookings,
  consumedTokens,
  drivers,
} from '@/server/db/schema';
import { transition } from '@/server/domain/booking-state';
import { dispatchLinkExpiry } from '@/server/domain/durations';
import { signDriverLink, verifyDriverLink } from '@/server/domain/link-tokens';
import type { Clock } from '@/server/ports/clock';
import { systemClock } from '@/server/ports/clock';
import type { NotificationPort } from '@/server/ports/notifications';
import type { SpreadsheetMirrorPort } from '@/server/ports/spreadsheet-mirror';
import { and, eq } from 'drizzle-orm';
import { recordAuditEvent } from './audit';
import { mirrorBooking } from './mirror';
import { createShortLink } from './short-links';
import { assignedSms, dispatchSms } from './sms-templates';

export interface DispatchDeps {
  db: Database;
  clock?: Clock;
  notifications: NotificationPort;
  secret: string;
  appUrl: string;
  mirror?: SpreadsheetMirrorPort;
}

export type GenerateLinkResult =
  | {
      ok: true;
      url: string;
      /** Branded short link (/s/<code>) used in the driver SMS/WhatsApp message. */
      shortUrl: string;
      /** wa.me link that pre-fills a WhatsApp message to the driver with the job link. */
      whatsappUrl: string;
      driver: Driver;
      booking: Booking;
    }
  | { ok: false; reason: 'booking_not_found' }
  | { ok: false; reason: 'driver_not_found' }
  | { ok: false; reason: 'driver_inactive' }
  | { ok: false; reason: 'wrong_state'; state: string };

export async function generateDispatchLink(
  bookingId: string,
  driverId: string,
  operatorId: string,
  deps: DispatchDeps,
): Promise<GenerateLinkResult> {
  const clock = deps.clock ?? systemClock;
  const [booking] = await deps.db
    .select()
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);
  if (!booking) return { ok: false, reason: 'booking_not_found' };
  if (booking.state !== 'unassigned') {
    return { ok: false, reason: 'wrong_state', state: booking.state };
  }

  const [driver] = await deps.db.select().from(drivers).where(eq(drivers.id, driverId)).limit(1);
  if (!driver) return { ok: false, reason: 'driver_not_found' };
  if (!driver.active) return { ok: false, reason: 'driver_inactive' };

  const jti = randomUUID();
  const token = await signDriverLink(deps.secret, {
    jobId: booking.id,
    driverId: driver.id,
    type: 'dispatch',
    jti,
    now: clock.now(),
    expiresAt: dispatchLinkExpiry(booking.pickupAt),
  });

  const appBase = deps.appUrl.replace(/\/+$/, '');
  const url = `${appBase}/j/${token}`;
  // Branded short link for messages (the long signed URL is the destination).
  const shortUrl = `${appBase}/s/${await createShortLink(deps.db, url)}`;
  // The manual WhatsApp message reuses the same formatted body as the SMS.
  const text = dispatchSms(booking, shortUrl);
  const whatsappNumber = driver.whatsappNumber.replace(/^\+/, '');
  const whatsappUrl = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(text)}`;

  await recordAuditEvent(deps.db, {
    actorType: 'operator',
    actorId: operatorId,
    entityType: 'booking',
    entityId: booking.id,
    action: 'dispatch_link_generated',
    before: null,
    after: { driverId: driver.id, jti },
  });

  // Note: the link is NOT auto-texted here. The operator triggers the SMS
  // explicitly (sendDriverDispatchSmsAction) once Twilio is configured; for now
  // they copy/open the link directly. Keeps minting side-effect-free.
  return { ok: true, url, shortUrl, whatsappUrl, driver, booking };
}

export type AcceptResult =
  | {
      ok: true;
      booking: Booking;
      driver: Driver;
      carForJob: CarType;
    }
  | { ok: false; reason: 'token_invalid' | 'token_expired' | 'token_consumed' }
  | { ok: false; reason: 'booking_not_found' }
  | { ok: false; reason: 'driver_not_found' }
  | { ok: false; reason: 'wrong_state'; state: string };

export interface AcceptInput {
  token: string;
  carOverride?: CarType;
}

export async function acceptDispatchLink(
  input: AcceptInput,
  deps: DispatchDeps,
): Promise<AcceptResult> {
  const clock = deps.clock ?? systemClock;
  const verified = await verifyDriverLink(deps.secret, input.token, clock.now());
  if (!verified.ok) {
    if (verified.reason === 'expired') return { ok: false, reason: 'token_expired' };
    return { ok: false, reason: 'token_invalid' };
  }
  const { jobId, driverId, type, jti, exp } = verified.payload;
  if (type !== 'dispatch') return { ok: false, reason: 'token_invalid' };

  // One-shot: refuse if jti has already been consumed.
  const [existingJti] = await deps.db
    .select()
    .from(consumedTokens)
    .where(eq(consumedTokens.jti, jti))
    .limit(1);
  if (existingJti) return { ok: false, reason: 'token_consumed' };

  const [booking] = await deps.db.select().from(bookings).where(eq(bookings.id, jobId)).limit(1);
  if (!booking) return { ok: false, reason: 'booking_not_found' };
  const [driver] = await deps.db.select().from(drivers).where(eq(drivers.id, driverId)).limit(1);
  if (!driver) return { ok: false, reason: 'driver_not_found' };

  const t = transition(booking.state, { type: 'driver_accept' });
  if (!t.ok) {
    return { ok: false, reason: 'wrong_state', state: booking.state };
  }
  const carForJob: CarType = input.carOverride ?? driver.defaultCarType;

  // Atomic update: only flip if state is still unassigned. Prevents races
  // where two link-clicks land near-simultaneously.
  const now = clock.now();
  const [updated] = await deps.db
    .update(bookings)
    .set({
      state: t.next,
      assignedDriverId: driver.id,
      carForThisJob: carForJob,
      assignedAt: now,
      updatedAt: now,
    })
    .where(and(eq(bookings.id, booking.id), eq(bookings.state, 'unassigned')))
    .returning();
  if (!updated) return { ok: false, reason: 'wrong_state', state: booking.state };

  // Consume the jti
  await deps.db.insert(consumedTokens).values({
    jti,
    expiresAt: new Date(exp * 1000),
  });

  await recordAuditEvent(deps.db, {
    actorType: 'driver',
    actorId: driver.id,
    entityType: 'booking',
    entityId: booking.id,
    action: 'driver_accept',
    before: { state: booking.state },
    after: { state: updated.state, driverId: driver.id, carForJob },
  });

  // Side effect: SMS exec
  await deps.notifications.sendSms({
    to: booking.execMobile,
    body: assignedSms(updated, driver, carForJob),
  });

  if (deps.mirror) await mirrorBooking(deps.db, deps.mirror, updated);

  return { ok: true, booking: updated, driver, carForJob };
}

export type DeclineResult =
  | { ok: true }
  | { ok: false; reason: 'token_invalid' | 'token_expired' | 'booking_not_found' | 'wrong_state' };

export async function declineDispatchLink(
  token: string,
  deps: DispatchDeps,
): Promise<DeclineResult> {
  const clock = deps.clock ?? systemClock;
  const verified = await verifyDriverLink(deps.secret, token, clock.now());
  if (!verified.ok) {
    if (verified.reason === 'expired') return { ok: false, reason: 'token_expired' };
    return { ok: false, reason: 'token_invalid' };
  }
  const { jobId, driverId, type } = verified.payload;
  if (type !== 'dispatch') return { ok: false, reason: 'token_invalid' };
  const [booking] = await deps.db.select().from(bookings).where(eq(bookings.id, jobId)).limit(1);
  if (!booking) return { ok: false, reason: 'booking_not_found' };
  if (booking.state !== 'unassigned') return { ok: false, reason: 'wrong_state' };

  await recordAuditEvent(deps.db, {
    actorType: 'driver',
    actorId: driverId,
    entityType: 'booking',
    entityId: booking.id,
    action: 'driver_decline',
    before: { state: booking.state },
    after: { state: booking.state },
  });
  return { ok: true };
}

export interface PreviewResult {
  booking: Booking;
  driver: Driver;
  expiresAt: Date;
}

export type PreviewLinkResult =
  | { ok: true; preview: PreviewResult }
  | {
      ok: false;
      reason:
        | 'token_invalid'
        | 'token_expired'
        | 'token_consumed'
        | 'booking_not_found'
        | 'driver_not_found'
        | 'wrong_state';
    };

export async function previewDispatchLink(
  token: string,
  deps: Omit<DispatchDeps, 'notifications'>,
): Promise<PreviewLinkResult> {
  const clock = deps.clock ?? systemClock;
  const verified = await verifyDriverLink(deps.secret, token, clock.now());
  if (!verified.ok) {
    if (verified.reason === 'expired') return { ok: false, reason: 'token_expired' };
    return { ok: false, reason: 'token_invalid' };
  }
  const { jobId, driverId, jti, exp } = verified.payload;
  const [existingJti] = await deps.db
    .select()
    .from(consumedTokens)
    .where(eq(consumedTokens.jti, jti))
    .limit(1);
  if (existingJti) return { ok: false, reason: 'token_consumed' };

  const [booking] = await deps.db.select().from(bookings).where(eq(bookings.id, jobId)).limit(1);
  if (!booking) return { ok: false, reason: 'booking_not_found' };
  const [driver] = await deps.db.select().from(drivers).where(eq(drivers.id, driverId)).limit(1);
  if (!driver) return { ok: false, reason: 'driver_not_found' };
  if (booking.state !== 'unassigned') {
    return { ok: false, reason: 'wrong_state' };
  }
  return { ok: true, preview: { booking, driver, expiresAt: new Date(exp * 1000) } };
}
