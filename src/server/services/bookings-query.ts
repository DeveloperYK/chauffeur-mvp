import { formatLondonDay, londonDayRangeUtc, londonMonthRangeUtc } from '@/lib/dates';
import type { Database } from '@/server/db';
import { type Booking, type BookingState, bookings } from '@/server/db/schema';
import { and, asc, desc, eq, gte, lt, sql } from 'drizzle-orm';

const ACTIVE_STATES: BookingState[] = [
  'unassigned',
  'assigned',
  'in_progress',
  'awaiting_driver_form',
  'awaiting_operator_review',
];

export async function listActiveBookings(db: Database): Promise<Booking[]> {
  return db.select().from(bookings).orderBy(asc(bookings.pickupAt)).limit(200);
}

/**
 * All bookings in a given state, across every day — used by saved views
 * ("Unassigned tickets", "Awaiting review") which triage by state rather
 * than by day.
 */
export async function listBookingsByState(db: Database, state: BookingState): Promise<Booking[]> {
  return db
    .select()
    .from(bookings)
    .where(eq(bookings.state, state))
    .orderBy(asc(bookings.pickupAt))
    .limit(500);
}

/**
 * All bookings whose pickup falls within the given London day, sorted by
 * pickup time. Includes every state so the board can render its 7 columns.
 *
 * The board derives its assignee facepile from this full set and filters by
 * selected assignee in memory, so the facepile stays stable regardless of
 * which assignees are selected (matching Jira).
 */
export async function listBookingsForDay(db: Database, dayStr: string): Promise<Booking[]> {
  const range = londonDayRangeUtc(dayStr);
  if (!range) return [];
  return db
    .select()
    .from(bookings)
    .where(and(gte(bookings.pickupAt, range.startUtc), lt(bookings.pickupAt, range.endUtc)))
    .orderBy(asc(bookings.pickupAt))
    .limit(500);
}

export async function listRecentCompletedAndCancelled(
  db: Database,
  limit = 50,
): Promise<Booking[]> {
  return db.select().from(bookings).orderBy(desc(bookings.updatedAt)).limit(limit);
}

export interface Board {
  unassigned: Booking[];
  assigned: Booking[];
  in_progress: Booking[];
  awaiting_driver_form: Booking[];
  awaiting_operator_review: Booking[];
  completed: Booking[];
  cancelled: Booking[];
}

export function groupByState(items: Booking[]): Board {
  const board: Board = {
    unassigned: [],
    assigned: [],
    in_progress: [],
    awaiting_driver_form: [],
    awaiting_operator_review: [],
    completed: [],
    cancelled: [],
  };
  for (const b of items) board[b.state].push(b);
  return board;
}

/**
 * Per-day count breakdown for the given London calendar month.
 *
 * Strategy: pull just the {pickupAt, state} pairs from the database and
 * bucket them in JS by their London day. At 60-100 bookings/day × ~31 days
 * that's at most ~3 000 small rows — cheap and avoids SQL-level timezone
 * shenanigans.
 */
export interface DayCounts {
  total: number;
  unassigned: number;
  /** total - unassigned: everything that's been picked up by a driver
   *  (assigned, in progress, awaiting form, awaiting review, completed)
   *  or has been cancelled. From the operator's perspective: no longer
   *  waiting for them. */
  dispatched: number;
}

export async function monthlyDayCounts(
  db: Database,
  monthStr: string,
): Promise<Map<string, DayCounts>> {
  const range = londonMonthRangeUtc(monthStr);
  if (!range) return new Map();

  const rows = await db
    .select({ pickupAt: bookings.pickupAt, state: bookings.state })
    .from(bookings)
    .where(and(gte(bookings.pickupAt, range.startUtc), lt(bookings.pickupAt, range.endUtc)))
    .limit(5000);

  const counts = new Map<string, DayCounts>();
  for (const row of rows) {
    const day = formatLondonDay(row.pickupAt);
    const cur = counts.get(day) ?? { total: 0, unassigned: 0, dispatched: 0 };
    cur.total += 1;
    if (row.state === 'unassigned') {
      cur.unassigned += 1;
    } else {
      cur.dispatched += 1;
    }
    counts.set(day, cur);
  }
  return counts;
}

// Quiet the linter — sql import is reserved for upcoming optimisations.
void sql;

export { ACTIVE_STATES };
