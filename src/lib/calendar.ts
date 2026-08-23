import { bookingRef } from '@/lib/booking-ref';
import { travelRefLabel } from '@/lib/travel-ref';
import type { Booking } from '@/server/db/schema';

/**
 * "Add to Google Calendar" for the driver job view. A calendar-template URL
 * needs no API, key or dependency: the driver taps it, Google Calendar opens
 * prefilled, and the saved event links back to their job page — a second way
 * back to the details besides the WhatsApp link.
 */

const CALENDAR_BASE = 'https://calendar.google.com/calendar/render';

/** UTC instant → Google Calendar's compact `YYYYMMDDTHHMMSSZ`. */
function calendarStamp(d: Date): string {
  return d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

export function driverJobCalendarUrl(booking: Booking, jobUrl: string): string {
  const passenger = `${booking.passengerFirstName} ${booking.passengerLastName ?? ''}`.trim();
  const start = booking.pickupAt;
  const end = new Date(start.getTime() + booking.expectedDurationMinutes * 60_000);
  const route =
    booking.serviceType === 'hourly'
      ? `${booking.pickupAddress} — As directed`
      : `${booking.pickupAddress} -> ${booking.dropoffAddress ?? 'As directed'}`;

  const detailLines = [route];
  const travel = travelRefLabel(booking.travelMode, booking.travelRef);
  if (travel) detailLines.push(travel);
  detailLines.push(`Job details: ${jobUrl}`);

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `JJ Chauffeuring ${bookingRef(booking.seq)} — ${passenger}`,
    dates: `${calendarStamp(start)}/${calendarStamp(end)}`,
    location: booking.pickupAddress,
    details: detailLines.join('\n'),
  });
  return `${CALENDAR_BASE}?${params.toString()}`;
}
