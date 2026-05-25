import { bookingRef } from '@/lib/booking-ref';
import { formatLondonDateTimeShort, formatLondonTimeOfDay } from '@/lib/dates';
import type { Booking, Driver } from '@/server/db/schema';

/**
 * Brand name on every customer-facing SMS so recipients can see at a glance
 * who the message is from. Placeholder until the official trading name is set —
 * change this single constant (and update the test) when it is.
 */
export const SMS_BRAND_NAME = 'Chauffeur MVP';

function displayCar(value: string): string {
  // Legacy enum-style fallback so old rows still read nicely.
  switch (value) {
    case 'ex':
      return 'Executive';
    case 's_class':
      return 'Mercedes S-Class';
    case 'mpv':
      return 'MPV';
    case 'mini_bus':
      return 'Mini bus';
    default:
      return value;
  }
}

/** Hourly hires have no destination — show "As directed" on the route line. */
function destination(booking: Booking): string {
  return booking.dropoffAddress ?? 'As directed';
}

/**
 * Exec — booking confirmed once a driver accepts.
 *
 *   Chauffeur MVP - BKNG-00001
 *   Confirmed: Sat 23 May, 14:00
 *   Driver: Marcus Bell (Mercedes S-Class)
 *   Pickup: 12 King St, London
 */
export function assignedSms(booking: Booking, driver: Driver, carForJob: string): string {
  return [
    `${SMS_BRAND_NAME} - ${bookingRef(booking.seq)}`,
    `Confirmed: ${formatLondonDateTimeShort(booking.pickupAt)}`,
    `Driver: ${driver.name} (${displayCar(carForJob)})`,
    `Pickup: ${booking.pickupAddress}`,
  ].join('\n');
}

/**
 * Exec — driver is on the way (clock fires ~1h before pickup).
 *
 *   Chauffeur MVP - BKNG-00001
 *   Your driver Marcus Bell is on the way for your 14:00 pickup.
 */
export function enRouteSms(booking: Booking, driver: Driver): string {
  return [
    `${SMS_BRAND_NAME} - ${bookingRef(booking.seq)}`,
    `Your driver ${driver.name} is on the way for your ${formatLondonTimeOfDay(booking.pickupAt)} pickup.`,
  ].join('\n');
}

/**
 * Driver — dispatch offer; they tap the link to accept.
 *
 *   Chauffeur MVP - New job BKNG-00001
 *   Sat 23 May, 14:00
 *   12 King St, London -> Heathrow T5
 *   Accept: <url>
 */
export function dispatchSms(booking: Booking, url: string): string {
  return [
    `${SMS_BRAND_NAME} - New job ${bookingRef(booking.seq)}`,
    formatLondonDateTimeShort(booking.pickupAt),
    `${booking.pickupAddress} -> ${destination(booking)}`,
    `Accept: ${url}`,
  ].join('\n');
}

/**
 * Driver — completion-form request after the trip.
 *
 *   Chauffeur MVP - BKNG-00001
 *   Please submit your trip form (car park, waiting, drop-off):
 *   <url>
 */
export function completionRequestSms(booking: Booking, url: string): string {
  return [
    `${SMS_BRAND_NAME} - ${bookingRef(booking.seq)}`,
    'Please submit your trip form (car park, waiting, drop-off):',
    url,
  ].join('\n');
}
