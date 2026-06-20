import { bookingRef } from '@/lib/booking-ref';
import { formatLondonDateTimeShort, formatLondonTimeOfDay } from '@/lib/dates';
import type { Booking } from '@/server/db/schema';

/**
 * The exec-facing templates only need the driver's display name. Taking the
 * narrow `{ name }` shape (rather than a full `Driver` row) lets the same
 * template name a backfill/subcontractor driver, who has no `drivers` row —
 * the operator-entered `backfillDriverName` is passed straight through.
 */
type NamedDriver = { name: string };

/**
 * Brand name on every customer-facing SMS so recipients can see at a glance
 * who the message is from. Placeholder until the official trading name is set —
 * change this single constant (and update the test) when it is.
 */
export const SMS_BRAND_NAME = 'Chauffeur MVP';

/** Transfer fallback if a dropoff is somehow missing. */
function destination(booking: Booking): string {
  return booking.dropoffAddress ?? 'As directed';
}

/** "4 hours" / "1 hour" / "1.5 hours" for an as-directed hire. */
function formatHireDuration(minutes: number): string {
  const hours = minutes / 60;
  if (Number.isInteger(hours)) return `${hours} hour${hours === 1 ? '' : 's'}`;
  return `${Math.round(hours * 10) / 10} hours`;
}

/**
 * Exec — booking confirmed once a driver accepts.
 *
 *   Chauffeur MVP - BKNG-00001
 *   Confirmed: Sat 23 May, 14:00
 *   Driver: Marcus Bell (Black Mercedes S-Class)
 *   Pickup: 12 King St, London
 *
 * `car` is the colour + car description (e.g. "Black Mercedes S-Class") so the
 * exec can identify the vehicle kerbside. Omitted from the line if blank.
 */
export function assignedSms(booking: Booking, driver: NamedDriver, car: string): string {
  const carPart = car.trim() ? ` (${car.trim()})` : '';
  return [
    `${SMS_BRAND_NAME} - ${bookingRef(booking.seq)}`,
    `Confirmed: ${formatLondonDateTimeShort(booking.pickupAt)}`,
    `Driver: ${driver.name}${carPart}`,
    `Pickup: ${booking.pickupAddress}`,
  ].join('\n');
}

/**
 * Exec — driver is on the way (clock fires ~1h before pickup).
 *
 *   Chauffeur MVP - BKNG-00001
 *   Your driver Marcus Bell is on the way for your 14:00 pickup.
 */
export function enRouteSms(booking: Booking, driver: NamedDriver): string {
  return [
    `${SMS_BRAND_NAME} - ${bookingRef(booking.seq)}`,
    `Your driver ${driver.name} is on the way for your ${formatLondonTimeOfDay(booking.pickupAt)} pickup.`,
  ].join('\n');
}

/**
 * Exec — their booking changed after it was confirmed; restate the current plan
 * (time, pickup, destination) so the exec's earlier confirmation isn't stale.
 *
 *   Chauffeur MVP - BKNG-00001
 *   Your booking has been updated.
 *   Pickup: Sat 23 May, 14:00 - 12 King St, London
 *   To: Heathrow T5
 */
export function changeExecSms(booking: Booking): string {
  const lines = [
    `${SMS_BRAND_NAME} - ${bookingRef(booking.seq)}`,
    'Your booking has been updated.',
    `Pickup: ${formatLondonDateTimeShort(booking.pickupAt)} - ${booking.pickupAddress}`,
  ];
  if (booking.serviceType === 'hourly') {
    lines.push(`As directed - ${formatHireDuration(booking.expectedDurationMinutes)}`);
  } else {
    lines.push(`To: ${destination(booking)}`);
  }
  return lines.join('\n');
}

/**
 * Driver — dispatch offer; they tap the link to accept.
 *
 * Transfer (point-to-point) shows the route; an as-directed hire shows the
 * pickup and the booked hire length instead:
 *
 *   Chauffeur MVP - New job BKNG-00001        Chauffeur MVP - New job BKNG-00002
 *   Sat 23 May, 14:00                         Sat 23 May, 14:00
 *   12 King St, London -> Heathrow T5         Pickup: 12 King St, London
 *   Accept: <url>                             As directed - 4 hours
 *                                             Accept: <url>
 */
export function dispatchSms(booking: Booking, url: string): string {
  const lines = [
    `${SMS_BRAND_NAME} - New job ${bookingRef(booking.seq)}`,
    formatLondonDateTimeShort(booking.pickupAt),
  ];
  if (booking.serviceType === 'hourly') {
    lines.push(
      `Pickup: ${booking.pickupAddress}`,
      `As directed - ${formatHireDuration(booking.expectedDurationMinutes)}`,
    );
  } else {
    lines.push(`${booking.pickupAddress} -> ${destination(booking)}`);
  }
  lines.push(`Accept: ${url}`);
  return lines.join('\n');
}

/**
 * Driver — they've been removed from a job they previously accepted
 * (operator reassigned the booking to someone else). Short and unambiguous;
 * the driver should know the job is no longer theirs.
 *
 *   Chauffeur MVP - BKNG-00001
 *   This booking has been reassigned. You're no longer on it.
 */
export function unassignedSms(booking: Booking): string {
  return [
    `${SMS_BRAND_NAME} - ${bookingRef(booking.seq)}`,
    "This booking has been reassigned. You're no longer on it.",
  ].join('\n');
}

/**
 * Driver — a booking they already accepted has changed; they tap to review the
 * new details and confirm they're across the new plan.
 *
 *   Chauffeur MVP - BKNG-00001
 *   Your booking has changed. Please review the new details and confirm:
 *   <url>
 */
export function changeSms(booking: Booking, url: string): string {
  return [
    `${SMS_BRAND_NAME} - ${bookingRef(booking.seq)}`,
    'Your booking has changed. Please review the new details and confirm:',
    url,
  ].join('\n');
}

/**
 * Driver — completion-form request after the trip.
 *
 *   Chauffeur MVP - BKNG-00001
 *   Please submit your trip form (arrival, on-board, completion times + parking):
 *   <url>
 */
export function completionRequestSms(booking: Booking, url: string): string {
  return [
    `${SMS_BRAND_NAME} - ${bookingRef(booking.seq)}`,
    'Please submit your trip form (arrival, on-board, completion times + parking):',
    url,
  ].join('\n');
}
