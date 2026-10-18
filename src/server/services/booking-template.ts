import { bookingRef } from '@/lib/booking-ref';
import { type BookingTemplate, templateFromBooking } from '@/lib/booking-template';
import type { Database } from '@/server/db';
import { bookings } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

/**
 * Load the reusable fields of an existing booking for "Copy booking" when the
 * source was picked by search (the console's panel already holds the full
 * booking and maps it client-side). Any state is copyable — a cancelled or
 * completed job describes a route and a client just as well as a live one.
 */
export type LoadBookingTemplateResult =
  | { ok: true; ref: string; template: BookingTemplate }
  | { ok: false; reason: 'booking_not_found' };

const idSchema = z.string().uuid();

export async function loadBookingTemplate(
  db: Database,
  bookingId: string,
): Promise<LoadBookingTemplateResult> {
  if (!idSchema.safeParse(bookingId).success) return { ok: false, reason: 'booking_not_found' };
  const [booking] = await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
  if (!booking) return { ok: false, reason: 'booking_not_found' };
  return { ok: true, ref: bookingRef(booking.seq), template: templateFromBooking(booking) };
}
