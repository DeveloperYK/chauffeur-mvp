import { randomUUID } from 'node:crypto';
import { whatsappWebLink } from '@/lib/whatsapp';
import type { Database } from '@/server/db';
import { type Booking, type Driver, bookings, drivers } from '@/server/db/schema';
import { dispatchLinkExpiry } from '@/server/domain/durations';
import { signDriverLink } from '@/server/domain/link-tokens';
import type { Clock } from '@/server/ports/clock';
import { systemClock } from '@/server/ports/clock';
import { eq } from 'drizzle-orm';
import { recordAuditEvent } from './audit';
import { listStops } from './booking-stops';
import { createShortLink } from './short-links';
import { driverJobSms } from './sms-templates';

export interface DriverJobLinkDeps {
  db: Database;
  clock?: Clock;
  secret: string;
  appUrl: string;
}

export type GenerateDriverJobLinkResult =
  | {
      ok: true;
      url: string;
      /** Branded short link (/s/<code>) used in the WhatsApp message. */
      shortUrl: string;
      /** WhatsApp Web link that pre-fills the job message to the driver. */
      whatsappUrl: string;
      /** The formatted driver message (what WhatsApp pre-fills; what Copy copies). */
      message: string;
      driver: Driver;
      booking: Booking;
    }
  | { ok: false; reason: 'booking_not_found' }
  | { ok: false; reason: 'no_driver' }
  | { ok: false; reason: 'wrong_state'; state: string };

/** States in which the assigned driver still needs the job in front of them. */
const JOB_LINK_STATES: ReadonlySet<string> = new Set(['assigned', 'in_progress']);

/**
 * Mint a job link for the driver who is already on the booking. A driver who
 * accepted an offer link keeps that link as their job view; a driver the
 * operator committed by phone (operator-attested) never had one — this gives
 * the operator a link to hand them so they can keep track of the job.
 *
 * The token is a `dispatch`-type link signed for the current assigned driver,
 * so `/j/<token>` renders the persistent job view (not an offer: the booking
 * is no longer unassigned). It expires at pickup + 48h like any dispatch link.
 * No dispatch offer is recorded — the job is already taken — and the driver is
 * not messaged here: the operator sends the message from the console.
 */
export async function generateDriverJobLink(
  bookingId: string,
  operatorId: string,
  deps: DriverJobLinkDeps,
): Promise<GenerateDriverJobLinkResult> {
  const clock = deps.clock ?? systemClock;
  const [booking] = await deps.db
    .select()
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);
  if (!booking) return { ok: false, reason: 'booking_not_found' };
  if (!JOB_LINK_STATES.has(booking.state)) {
    return { ok: false, reason: 'wrong_state', state: booking.state };
  }
  if (!booking.assignedDriverId) return { ok: false, reason: 'no_driver' };

  const [driver] = await deps.db
    .select()
    .from(drivers)
    .where(eq(drivers.id, booking.assignedDriverId))
    .limit(1);
  if (!driver) return { ok: false, reason: 'no_driver' };

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
  const shortUrl = `${appBase}/s/${await createShortLink(deps.db, url)}`;
  const message = driverJobSms(booking, shortUrl, await listStops(deps.db, booking.id));
  const whatsappUrl = whatsappWebLink(driver.whatsappNumber, message);

  await recordAuditEvent(deps.db, {
    actorType: 'operator',
    actorId: operatorId,
    entityType: 'booking',
    entityId: booking.id,
    action: 'driver_job_link_generated',
    before: null,
    after: { driverId: driver.id, jti },
  });

  return { ok: true, url, shortUrl, whatsappUrl, message, driver, booking };
}
