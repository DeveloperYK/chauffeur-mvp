'use server';

import { bookingRef } from '@/lib/booking-ref';
import { currentSession } from '@/server/auth/current';
import { db } from '@/server/composition';
import type { BookingState } from '@/server/db/schema';
import { type BookingMatchType, searchBookings } from '@/server/services/bookings-query';

/** Serializable search result row for the command palette. */
export interface SearchResult {
  id: string;
  seq: number;
  ref: string;
  state: BookingState;
  pickupAt: string;
  passengerFirstName: string;
  passengerLastName: string | null;
  driverName: string | null;
  pickupAddress: string;
  dropoffAddress: string | null;
  /** Field category this row matched on — drives the grouped headers. */
  matchType: BookingMatchType;
}

/**
 * Operator-only global booking search backing the command palette.
 * Returns [] for unauthenticated callers or an empty query.
 */
export async function searchBookingsAction(query: string): Promise<SearchResult[]> {
  const session = await currentSession();
  if (!session) return [];

  const q = query.trim();
  if (!q) return [];

  const hits = await searchBookings(db(), q, { limit: 20 });
  return hits.map((b) => ({
    id: b.id,
    seq: b.seq,
    ref: bookingRef(b.seq),
    state: b.state,
    pickupAt: b.pickupAt.toISOString(),
    passengerFirstName: b.passengerFirstName,
    passengerLastName: b.passengerLastName,
    driverName: b.driverName,
    pickupAddress: b.pickupAddress,
    dropoffAddress: b.dropoffAddress,
    matchType: b.matchType,
  }));
}
