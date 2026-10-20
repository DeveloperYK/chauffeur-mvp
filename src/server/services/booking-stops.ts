/**
 * Intermediate stops of a multi-stop transfer (docs/shaping/multi-stop).
 * The stop list is always written as a whole — replace, never patch — so
 * `seq` is dense from 1 and matches what the operator sees in the form.
 */
import type { Database } from '@/server/db';
import { type BookingStop, bookingStops } from '@/server/db/schema';
import { asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { MAX_PLANNED_WAIT_MINUTES, MAX_STOPS } from '@/lib/stops';

export { MAX_PLANNED_WAIT_MINUTES, MAX_STOPS };

export const stopInputSchema = z
  .object({
    address: z.string().trim().min(3, 'Stop address is required').max(500),
    placeId: z.string().trim().max(200).optional().nullable(),
    plannedWaitMinutes: z.coerce
      .number()
      .int()
      .min(0, 'Wait cannot be negative')
      .max(MAX_PLANNED_WAIT_MINUTES, 'Wait cannot exceed 12 hours')
      .optional()
      .default(0),
  })
  .strict();

export const stopsInputSchema = z
  .array(stopInputSchema)
  .max(MAX_STOPS, `No more than ${MAX_STOPS} stops`);

export type StopInput = z.input<typeof stopInputSchema>;
export type ParsedStop = z.output<typeof stopInputSchema>;

/** Zod issue for stops on a booking type that cannot carry them (hourly). */
export function refineStopsForServiceType(
  data: { serviceType?: string | undefined; stops?: unknown[] | undefined },
  ctx: z.RefinementCtx,
): void {
  if (data.serviceType === 'hourly' && (data.stops?.length ?? 0) > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['stops'],
      message: 'An as-directed booking has no fixed stops',
    });
  }
}

/** Stops for many bookings, `seq` order, keyed by booking id (absent = none). */
export async function listStopsForBookings(
  db: Database,
  bookingIds: string[],
): Promise<Map<string, BookingStop[]>> {
  const map = new Map<string, BookingStop[]>();
  if (bookingIds.length === 0) return map;
  const rows = await db
    .select()
    .from(bookingStops)
    .where(inArray(bookingStops.bookingId, bookingIds))
    .orderBy(asc(bookingStops.bookingId), asc(bookingStops.seq));
  for (const row of rows) {
    const list = map.get(row.bookingId);
    if (list) list.push(row);
    else map.set(row.bookingId, [row]);
  }
  return map;
}

/** Stops of one booking in `seq` order (empty array when none). */
export async function listStops(db: Database, bookingId: string): Promise<BookingStop[]> {
  return (await listStopsForBookings(db, [bookingId])).get(bookingId) ?? [];
}

/**
 * Replace the whole stop list of a booking. Pass the transaction handle when
 * called inside one so the booking and its stops land (or fail) together.
 */
export async function replaceStops(
  db: Database,
  bookingId: string,
  stops: readonly ParsedStop[],
): Promise<BookingStop[]> {
  await db.delete(bookingStops).where(eq(bookingStops.bookingId, bookingId));
  if (stops.length === 0) return [];
  return db
    .insert(bookingStops)
    .values(
      stops.map((s, i) => ({
        bookingId,
        seq: i + 1,
        address: s.address,
        placeId: s.placeId ?? null,
        plannedWaitMinutes: s.plannedWaitMinutes ?? 0,
      })),
    )
    .returning();
}
