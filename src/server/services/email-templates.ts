import { bookingRef } from '@/lib/booking-ref';
import { formatLondonDateTimeShort, formatLondonTimeOfDay } from '@/lib/dates';
import type { Booking } from '@/server/db/schema';
import { SMS_BRAND_NAME } from './sms-templates';

/**
 * Exec-facing email templates — the email-channel counterparts of the SMS
 * templates, carrying the same information. Plain text only (no user-controlled
 * HTML), matching the SMS safety posture. Each returns a subject + text body.
 */
type NamedDriver = { name: string };

/** Exec — booking confirmed once a driver accepts. */
export function assignedEmail(
  booking: Booking,
  driver: NamedDriver,
  car: string,
): { subject: string; text: string } {
  const carPart = car.trim() ? ` (${car.trim()})` : '';
  const ref = bookingRef(booking.seq);
  return {
    subject: `${SMS_BRAND_NAME} - ${ref} confirmed`,
    text: [
      `${SMS_BRAND_NAME} - ${ref}`,
      `Confirmed: ${formatLondonDateTimeShort(booking.pickupAt)}`,
      `Driver: ${driver.name}${carPart}`,
      `Pickup: ${booking.pickupAddress}`,
    ].join('\n'),
  };
}

/** Exec — driver is on the way (clock fires ~1h before pickup). */
export function enRouteEmail(
  booking: Booking,
  driver: NamedDriver,
): { subject: string; text: string } {
  const ref = bookingRef(booking.seq);
  return {
    subject: `${SMS_BRAND_NAME} - ${ref} driver en route`,
    text: [
      `${SMS_BRAND_NAME} - ${ref}`,
      `Your driver ${driver.name} is on the way for your ${formatLondonTimeOfDay(booking.pickupAt)} pickup.`,
    ].join('\n'),
  };
}
