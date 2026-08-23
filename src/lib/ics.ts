import { bookingRef } from '@/lib/booking-ref';
import { travelRefLabel } from '@/lib/travel-ref';
import type { Booking } from '@/server/db/schema';

/**
 * iCalendar (.ics) event for the driver job view — the Apple Calendar
 * counterpart to the Google Calendar template URL in `calendar.ts`. Served by
 * the /j/[token]/calendar route (same token gating as the job view); Safari on
 * iOS offers "Add to Calendar" for `text/calendar` responses. RFC 5545: CRLF
 * line endings, text escaping, and 75-octet line folding.
 */

/** UTC instant → iCalendar's compact `YYYYMMDDTHHMMSSZ`. */
function icsStamp(d: Date): string {
  return d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

/** Escape TEXT values: backslash, semicolon, comma, newline (RFC 5545 §3.3.11). */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Fold a content line at 75 octets; continuations start with a single space
 * (RFC 5545 §3.1). Splits on byte length, backing off to avoid cutting a
 * multi-byte UTF-8 character.
 */
function foldLine(line: string): string[] {
  const out: string[] = [];
  let rest = line;
  let limit = 75;
  while (Buffer.byteLength(rest, 'utf8') > limit) {
    let cut = limit;
    while (cut > 1 && Buffer.byteLength(rest.slice(0, cut), 'utf8') > limit) cut--;
    out.push(rest.slice(0, cut));
    rest = ` ${rest.slice(cut)}`;
    limit = 75;
  }
  out.push(rest);
  return out;
}

export function driverJobIcs(booking: Booking, jobUrl: string): string {
  const passenger = `${booking.passengerFirstName} ${booking.passengerLastName ?? ''}`.trim();
  const start = booking.pickupAt;
  const end = new Date(start.getTime() + booking.expectedDurationMinutes * 60_000);
  const route =
    booking.serviceType === 'hourly'
      ? `${booking.pickupAddress} — As directed`
      : `${booking.pickupAddress} -> ${booking.dropoffAddress ?? 'As directed'}`;

  const descriptionLines = [route];
  const travel = travelRefLabel(booking.travelMode, booking.travelRef);
  if (travel) descriptionLines.push(travel);
  descriptionLines.push(`Job details: ${jobUrl}`);

  const contentLines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//JJ Chauffeuring//Dispatch//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${booking.id}@jj-chauffeuring`,
    `DTSTAMP:${icsStamp(booking.updatedAt)}`,
    `DTSTART:${icsStamp(start)}`,
    `DTEND:${icsStamp(end)}`,
    `SUMMARY:${escapeText(`JJ Chauffeuring ${bookingRef(booking.seq)} — ${passenger}`)}`,
    `LOCATION:${escapeText(booking.pickupAddress)}`,
    `DESCRIPTION:${escapeText(descriptionLines.join('\n'))}`,
    `URL:${jobUrl}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return `${contentLines.flatMap(foldLine).join('\r\n')}\r\n`;
}
