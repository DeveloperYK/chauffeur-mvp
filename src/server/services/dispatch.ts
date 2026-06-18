import { randomUUID } from 'node:crypto';
import { carDescription } from '@/lib/labels';
import { whatsappWebLink } from '@/lib/whatsapp';
import type { Database } from '@/server/db';
import { type Booking, type Driver, bookings, consumedTokens, drivers } from '@/server/db/schema';
import { transition } from '@/server/domain/booking-state';
import { dispatchLinkExpiry } from '@/server/domain/durations';
import { signDriverLink, verifyDriverLink } from '@/server/domain/link-tokens';
import type { Clock } from '@/server/ports/clock';
import { systemClock } from '@/server/ports/clock';
import type { NotificationPort } from '@/server/ports/notifications';
import type { SpreadsheetMirrorPort } from '@/server/ports/spreadsheet-mirror';
import { and, eq } from 'drizzle-orm';
import { recordAuditEvent } from './audit';
import { sendExecNotification } from './exec-notifications';
import { mirrorBooking } from './mirror';
import { recordDispatchOffer, resolveOffersOnAccept } from './offers';
import { createShortLink } from './short-links';
import { dispatchSms, unassignedSms } from './sms-templates';

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
      /** WhatsApp Web link that pre-fills a message to the driver with the job link. */
      whatsappUrl: string;
      driver: Driver;
      booking: Booking;
    }
  | { ok: false; reason: 'booking_not_found' }
  | { ok: false; reason: 'driver_not_found' }
  | { ok: false; reason: 'driver_inactive' }
  | { ok: false; reason: 'wrong_state'; state: string };

/** A minted, ready-to-send dispatch link for one driver. */
export interface DispatchLinkOffer {
  driver: Driver;
  url: string;
  /** Branded short link (/s/<code>) used in the WhatsApp message. */
  shortUrl: string;
  /** WhatsApp Web link that pre-fills a message to the driver with the job link. */
  whatsappUrl: string;
}

/**
 * Mint one per-driver dispatch link and record the audit row. The caller must
 * have already verified the booking is dispatchable (unassigned) and that the
 * driver is active. Side-effect-free beyond the short link + audit (no SMS).
 */
async function mintDispatchLinkFor(
  booking: Booking,
  driver: Driver,
  operatorId: string,
  deps: DispatchDeps,
): Promise<DispatchLinkOffer> {
  const clock = deps.clock ?? systemClock;
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
  const whatsappUrl = whatsappWebLink(driver.whatsappNumber, text);

  await recordAuditEvent(deps.db, {
    actorType: 'operator',
    actorId: operatorId,
    entityType: 'booking',
    entityId: booking.id,
    action: 'dispatch_link_generated',
    before: null,
    after: { driverId: driver.id, jti },
  });

  // Persist the offer so the console can show "Offered to N · awaiting" and so
  // the fan-out can be resolved (winner accepted, rest lapsed) on first accept.
  await recordDispatchOffer(
    deps.db,
    { bookingId: booking.id, driverId: driver.id, jti },
    clock.now(),
  );

  return { driver, url, shortUrl, whatsappUrl };
}

export async function generateDispatchLink(
  bookingId: string,
  driverId: string,
  operatorId: string,
  deps: DispatchDeps,
): Promise<GenerateLinkResult> {
  const [booking] = await deps.db
    .select()
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);
  if (!booking) return { ok: false, reason: 'booking_not_found' };
  // Dispatch is only from 'unassigned'. Reassigning a driver who pulled out is
  // a two-step flow: the operator first releases the booking back to
  // 'unassigned' (see releaseDriver), then dispatches a new driver here. So a
  // booking that's already 'assigned' (or further) is out of scope.
  if (booking.state !== 'unassigned') {
    return { ok: false, reason: 'wrong_state', state: booking.state };
  }

  const [driver] = await deps.db.select().from(drivers).where(eq(drivers.id, driverId)).limit(1);
  if (!driver) return { ok: false, reason: 'driver_not_found' };
  if (!driver.active) return { ok: false, reason: 'driver_inactive' };

  // Note: minting is side-effect-free. The operator delivers the link to
  // the driver themselves via the WhatsApp deep-link button on the modal.
  const offer = await mintDispatchLinkFor(booking, driver, operatorId, deps);
  return {
    ok: true,
    url: offer.url,
    shortUrl: offer.shortUrl,
    whatsappUrl: offer.whatsappUrl,
    driver,
    booking,
  };
}

export type GenerateLinksResult =
  | {
      ok: true;
      offers: DispatchLinkOffer[];
      skipped: { driverId: string; reason: 'driver_not_found' | 'driver_inactive' }[];
    }
  | { ok: false; reason: 'booking_not_found' | 'wrong_state' | 'no_drivers'; state?: string };

/**
 * Fan-out dispatch: mint a per-driver link for each selected driver in one pass
 * (the operator then sends each over WhatsApp). The booking stays unassigned —
 * no driver is committed — and the first to accept wins via the existing atomic
 * gate in `acceptDispatchLink`. Unknown/inactive drivers are skipped, not fatal.
 */
export async function generateDispatchLinks(
  bookingId: string,
  driverIds: string[],
  operatorId: string,
  deps: DispatchDeps,
): Promise<GenerateLinksResult> {
  const unique = [...new Set(driverIds)];
  if (unique.length === 0) return { ok: false, reason: 'no_drivers' };

  const [booking] = await deps.db
    .select()
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);
  if (!booking) return { ok: false, reason: 'booking_not_found' };
  if (booking.state !== 'unassigned') {
    return { ok: false, reason: 'wrong_state', state: booking.state };
  }

  const offers: DispatchLinkOffer[] = [];
  const skipped: { driverId: string; reason: 'driver_not_found' | 'driver_inactive' }[] = [];
  for (const driverId of unique) {
    const [driver] = await deps.db.select().from(drivers).where(eq(drivers.id, driverId)).limit(1);
    if (!driver) {
      skipped.push({ driverId, reason: 'driver_not_found' });
      continue;
    }
    if (!driver.active) {
      skipped.push({ driverId, reason: 'driver_inactive' });
      continue;
    }
    offers.push(await mintDispatchLinkFor(booking, driver, operatorId, deps));
  }

  return { ok: true, offers, skipped };
}

export type AcceptResult =
  | {
      ok: true;
      booking: Booking;
      driver: Driver;
    }
  | { ok: false; reason: 'token_invalid' | 'token_expired' | 'token_consumed' }
  | { ok: false; reason: 'booking_not_found' }
  | { ok: false; reason: 'driver_not_found' }
  | { ok: false; reason: 'wrong_state'; state: string };

export interface AcceptInput {
  token: string;
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

  const now = clock.now();

  // Accept always lands on the initial dispatch path: unassigned → assigned.
  // A driver who pulled out is handled by releaseDriver (assigned → unassigned)
  // before a new driver is dispatched, so there's no in-place "swap" here.
  const t = transition(booking.state, { type: 'driver_accept' });
  if (!t.ok) {
    return { ok: false, reason: 'wrong_state', state: booking.state };
  }

  // Atomic update: only flip if state is still unassigned. Prevents races
  // where two link-clicks land near-simultaneously.
  const [updated] = await deps.db
    .update(bookings)
    .set({
      state: t.next,
      assignedDriverId: driver.id,
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
    after: { state: updated.state, driverId: driver.id },
  });

  // Resolve the fan-out: this driver's offer is accepted, any other open offers
  // on the booking lapse (the operator's console clears its "awaiting" count).
  await resolveOffersOnAccept(deps.db, booking.id, driver.id, now);

  // Confirm the exec — name the driver and their car + colour so they can
  // identify the vehicle kerbside. Routed through sendExecNotification so the
  // attempt is recorded and a failed send is never silent.
  await sendExecNotification(
    { db: deps.db, notifications: deps.notifications },
    {
      booking: updated,
      kind: 'assigned',
      driverName: driver.name,
      car: carDescription(driver.car, driver.carColour),
    },
  );

  if (deps.mirror) await mirrorBooking(deps.db, deps.mirror, updated);

  return { ok: true, booking: updated, driver };
}

export type ReleaseDriverResult =
  | { ok: true; booking: Booking }
  | { ok: false; reason: 'booking_not_found' | 'wrong_state'; state?: string };

/**
 * Release the currently-assigned driver and move the booking back to
 * 'unassigned' (the "driver pulled out" flow). The dropped driver is SMS'd that
 * they're off; the booking re-enters the dispatch queue so the operator can
 * send a fresh dispatch link to someone else. The exec is NOT messaged here —
 * they only ever get a confirmation when a driver accepts.
 */
export async function releaseDriver(
  bookingId: string,
  operatorId: string,
  deps: DispatchDeps,
): Promise<ReleaseDriverResult> {
  const clock = deps.clock ?? systemClock;
  const [booking] = await deps.db
    .select()
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);
  if (!booking) return { ok: false, reason: 'booking_not_found' };

  const t = transition(booking.state, { type: 'driver_released' });
  if (!t.ok) return { ok: false, reason: 'wrong_state', state: booking.state };

  const previousDriverId = booking.assignedDriverId;
  const now = clock.now();

  // Atomic gate on the current state so a concurrent transition (e.g. the clock
  // moving it to in_progress) can't be clobbered. Clears the driver assignment
  // and resets the no-accept flag so the 24h timer restarts from now. Also
  // clears the backfill marking — a released booking is a clean unassigned
  // ticket again, whether the dropped driver was internal or a backfill.
  const [updated] = await deps.db
    .update(bookings)
    .set({
      state: t.next,
      assignedDriverId: null,
      assignedAt: null,
      flaggedAt: null,
      isBackfill: false,
      backfillDriverName: null,
      backfillDriverPhone: null,
      backfillCar: null,
      backfillDriverPayPence: null,
      updatedAt: now,
    })
    .where(and(eq(bookings.id, booking.id), eq(bookings.state, 'assigned')))
    .returning();
  if (!updated) return { ok: false, reason: 'wrong_state', state: booking.state };

  await recordAuditEvent(deps.db, {
    actorType: 'operator',
    actorId: operatorId,
    entityType: 'booking',
    entityId: booking.id,
    action: 'driver_released',
    before: { state: booking.state, driverId: previousDriverId },
    after: { state: updated.state, driverId: null },
  });

  // Tell the dropped driver they're off the job.
  if (previousDriverId) {
    const [previousDriver] = await deps.db
      .select()
      .from(drivers)
      .where(eq(drivers.id, previousDriverId))
      .limit(1);
    if (previousDriver) {
      await deps.notifications.sendSms({
        to: previousDriver.whatsappNumber,
        body: unassignedSms(updated),
      });
    }
  }

  if (deps.mirror) await mirrorBooking(deps.db, deps.mirror, updated);

  return { ok: true, booking: updated };
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
  // A dispatch link is only valid while the booking is still unassigned. Once a
  // driver has accepted (assigned) or the trip has moved on, the link is closed.
  if (booking.state !== 'unassigned') {
    return { ok: false, reason: 'wrong_state' };
  }
  return { ok: true, preview: { booking, driver, expiresAt: new Date(exp * 1000) } };
}
