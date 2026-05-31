import type { Database } from '@/server/db';
import { type DispatchOffer, dispatchOffers, drivers } from '@/server/db/schema';
import { and, eq, inArray, ne } from 'drizzle-orm';

// Dispatch-offer bookkeeping. One offer = one minted dispatch link to one
// driver. The booking stays unassigned while offers are open; the first driver
// to accept wins (see acceptDispatchLink) and the rest lapse. These helpers are
// the single place that mutates the dispatch_offers table.

export interface RecordOfferInput {
  bookingId: string;
  driverId: string;
  jti: string;
}

/**
 * Record a freshly-minted offer as `open`. If this driver already has an open
 * offer on this booking (operator re-sent the link), the previous one is lapsed
 * first so a driver is only ever counted once in "Offered to N · awaiting".
 */
export async function recordDispatchOffer(
  db: Database,
  input: RecordOfferInput,
  now: Date,
): Promise<DispatchOffer> {
  await db
    .update(dispatchOffers)
    .set({ status: 'lapsed', respondedAt: now })
    .where(
      and(
        eq(dispatchOffers.bookingId, input.bookingId),
        eq(dispatchOffers.driverId, input.driverId),
        eq(dispatchOffers.status, 'open'),
      ),
    );

  const [offer] = await db
    .insert(dispatchOffers)
    .values({
      bookingId: input.bookingId,
      driverId: input.driverId,
      jti: input.jti,
      status: 'open',
      createdAt: now,
    })
    .returning();
  // The insert always returns a row; the cast keeps the return type non-optional
  // (Drizzle types .returning() as an array).
  return offer as DispatchOffer;
}

/**
 * The accepting driver won the fan-out: mark their open offer `accepted` and
 * lapse every other open offer on the booking. Idempotent — re-running with an
 * already-resolved booking is a no-op.
 */
export async function resolveOffersOnAccept(
  db: Database,
  bookingId: string,
  acceptingDriverId: string,
  now: Date,
): Promise<void> {
  await db
    .update(dispatchOffers)
    .set({ status: 'accepted', respondedAt: now })
    .where(
      and(
        eq(dispatchOffers.bookingId, bookingId),
        eq(dispatchOffers.driverId, acceptingDriverId),
        eq(dispatchOffers.status, 'open'),
      ),
    );

  await db
    .update(dispatchOffers)
    .set({ status: 'lapsed', respondedAt: now })
    .where(
      and(
        eq(dispatchOffers.bookingId, bookingId),
        ne(dispatchOffers.driverId, acceptingDriverId),
        eq(dispatchOffers.status, 'open'),
      ),
    );
}

/**
 * Lapse every open offer on a booking (e.g. when it is cancelled). No-op if none
 * are open.
 */
export async function lapseOpenOffers(db: Database, bookingId: string, now: Date): Promise<void> {
  await db
    .update(dispatchOffers)
    .set({ status: 'lapsed', respondedAt: now })
    .where(and(eq(dispatchOffers.bookingId, bookingId), eq(dispatchOffers.status, 'open')));
}

/** A driver awaiting a response on an open offer. */
export interface OpenOfferDriver {
  driverId: string;
  driverName: string;
}

/**
 * Open offers per booking, joined to driver names, for the given booking ids.
 * Returns a Map keyed by booking id; bookings with no open offers are absent.
 * Used by the console to render "Offered to N · awaiting".
 */
export async function openOffersForBookings(
  db: Database,
  bookingIds: string[],
): Promise<Map<string, OpenOfferDriver[]>> {
  const result = new Map<string, OpenOfferDriver[]>();
  if (bookingIds.length === 0) return result;

  const rows = await db
    .select({
      bookingId: dispatchOffers.bookingId,
      driverId: dispatchOffers.driverId,
      driverName: drivers.name,
    })
    .from(dispatchOffers)
    .innerJoin(drivers, eq(dispatchOffers.driverId, drivers.id))
    .where(and(eq(dispatchOffers.status, 'open'), inArray(dispatchOffers.bookingId, bookingIds)));

  for (const row of rows) {
    const list = result.get(row.bookingId) ?? [];
    list.push({ driverId: row.driverId, driverName: row.driverName });
    result.set(row.bookingId, list);
  }
  return result;
}
