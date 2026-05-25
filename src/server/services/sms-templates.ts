import { bookingRef } from '@/lib/booking-ref';
import type { Booking, Driver } from '@/server/db/schema';

/**
 * Brand prefix on every customer-facing SMS so recipients can see at a glance
 * who the message is from. Placeholder until the official trading name is set —
 * change this single constant (and update the test) when it is.
 */
export const SMS_BRAND_NAME = 'Chauffeur MVP';

/**
 * Every message leads with the brand + the booking reference, e.g.
 * "Chauffeur MVP (BKNG-00001):", so the recipient can quote the ref back to us.
 */
function prefix(booking: Booking): string {
  return `${SMS_BRAND_NAME} (${bookingRef(booking.seq)})`;
}

function timeLine(d: Date): string {
  return `${d.toISOString().replace('T', ' ').slice(0, 16)} UTC`;
}

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

export function assignedSms(booking: Booking, driver: Driver, carForJob: string): string {
  return `${prefix(booking)}: Your chauffeur for ${timeLine(booking.pickupAt)} is confirmed. Driver: ${driver.name}. Car: ${displayCar(carForJob)}. Pickup: ${booking.pickupAddress}`;
}

export function enRouteSms(booking: Booking, driver: Driver): string {
  return `${prefix(booking)}: Your driver ${driver.name} is en route for pickup at ${timeLine(booking.pickupAt)}.`;
}

/** Dispatch offer texted to the driver — they tap the link to accept the job. */
export function dispatchSms(booking: Booking, driver: Driver, url: string): string {
  return `${prefix(booking)}: New job for ${driver.name} — pickup ${timeLine(booking.pickupAt)} from ${booking.pickupAddress}. Accept here: ${url}`;
}

/** Completion-form request texted to the driver after the trip. */
export function completionRequestSms(booking: Booking, driver: Driver, url: string): string {
  return `${prefix(booking)}: ${driver.name}, please submit the completion form for the ${timeLine(booking.pickupAt)} job: ${url}`;
}
