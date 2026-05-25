import { parseBookingQuery } from '@/lib/booking-ref';
import { formatLondonDay, londonDayRangeUtc, londonMonthRangeUtc } from '@/lib/dates';
import type { Database } from '@/server/db';
import { type Booking, type BookingState, bookings, drivers } from '@/server/db/schema';
import { type SQL, and, asc, desc, eq, gte, ilike, inArray, lt, or, sql } from 'drizzle-orm';

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

/** All bookings whose pickup falls within [startUtc, endUtc). Used by the
 *  drivers schedule (day timeline + week grid). */
export async function listBookingsBetween(
  db: Database,
  startUtc: Date,
  endUtc: Date,
): Promise<Booking[]> {
  return db
    .select()
    .from(bookings)
    .where(and(gte(bookings.pickupAt, startUtc), lt(bookings.pickupAt, endUtc)))
    .orderBy(asc(bookings.pickupAt))
    .limit(2000);
}

export interface BookingSearchHit extends Booking {
  /** Name of the assigned driver, if any — joined for both matching and display. */
  driverName: string | null;
}

const SEARCH_LIMIT = 20;

/** Escape LIKE wildcards so a literal % or _ in the query matches literally. */
function likeContains(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * Global booking search for the command palette. Matches:
 * - the exact booking reference (`seq`) when the query parses as an ID
 *   (`42` / `00042` / `BKNG-00042`), otherwise
 * - a case-insensitive substring across passenger name, assigned driver name,
 *   pickup/dropoff address, account code, case code, and vehicle.
 *
 * Optionally scopes to one driver (with or without a term). Bounded, newest
 * pickup first. Plain ILIKE only (no pg_trgm/tsvector) so it runs identically
 * on Supabase and the PGlite test DB; revisit with a trigram index past ~100k rows.
 */
export async function searchBookings(
  db: Database,
  query: string,
  opts: { driverId?: string; limit?: number } = {},
): Promise<BookingSearchHit[]> {
  const q = query.trim();
  const { driverId } = opts;
  if (!q && !driverId) return [];

  const conditions: SQL[] = [];

  if (q) {
    const seq = parseBookingQuery(q);
    if (seq !== null) {
      conditions.push(eq(bookings.seq, seq));
    } else {
      const pattern = likeContains(q);
      const term = or(
        ilike(bookings.passengerFirstName, pattern),
        ilike(bookings.passengerLastName, pattern),
        ilike(drivers.name, pattern),
        ilike(bookings.pickupAddress, pattern),
        ilike(bookings.dropoffAddress, pattern),
        ilike(bookings.accountCode, pattern),
        ilike(bookings.caseCode, pattern),
        ilike(bookings.carForThisJob, pattern),
      );
      if (term) conditions.push(term);
    }
  }

  if (driverId) conditions.push(eq(bookings.assignedDriverId, driverId));

  const rows = await db
    .select({ booking: bookings, driverName: drivers.name })
    .from(bookings)
    .leftJoin(drivers, eq(bookings.assignedDriverId, drivers.id))
    .where(and(...conditions))
    .orderBy(desc(bookings.pickupAt))
    .limit(opts.limit ?? SEARCH_LIMIT);

  return rows.map((r) => ({ ...r.booking, driverName: r.driverName ?? null }));
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
  /** total - unassigned: everything that has a driver attached (assigned, in
   *  progress, awaiting form, awaiting review, completed) or is cancelled.
   *  From the operator's perspective: no longer waiting for them. Shown in the
   *  calendar as "assigned". */
  assigned: number;
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
    const cur = counts.get(day) ?? { total: 0, unassigned: 0, assigned: 0 };
    cur.total += 1;
    if (row.state === 'unassigned') {
      cur.unassigned += 1;
    } else {
      cur.assigned += 1;
    }
    counts.set(day, cur);
  }
  return counts;
}

// Quiet the linter — sql import is reserved for upcoming optimisations.
void sql;

/**
 * Per-driver dispatch context used by the dispatch picker:
 * - `weekLoads`: how many open jobs each driver holds in the current week
 *   (drives the bandwidth bar), keyed by driver id.
 * - `windows`: busy windows (start/end ms) for every open assignment, so the
 *   picker can flag drivers whose existing job overlaps the new pickup.
 *
 * "Open" excludes completed and cancelled bookings.
 */
export interface DriverDispatchData {
  weekLoads: Record<string, number>;
  windows: Array<{ driverId: string; startMs: number; endMs: number }>;
}

export async function driverDispatchData(
  db: Database,
  now: Date = new Date(),
): Promise<DriverDispatchData> {
  const rows = await db
    .select({
      assignedDriverId: bookings.assignedDriverId,
      pickupAt: bookings.pickupAt,
      expectedDurationMinutes: bookings.expectedDurationMinutes,
    })
    .from(bookings)
    .where(inArray(bookings.state, ACTIVE_STATES));

  // Current week boundaries (Mon 00:00 → next Mon 00:00), local server time.
  const weekStart = new Date(now);
  const dow = (weekStart.getDay() + 6) % 7; // 0 = Monday
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - dow);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);

  const weekLoads: Record<string, number> = {};
  const windows: DriverDispatchData['windows'] = [];
  for (const r of rows) {
    if (!r.assignedDriverId) continue;
    const startMs = r.pickupAt.getTime();
    const endMs = startMs + (r.expectedDurationMinutes || 60) * 60_000;
    windows.push({ driverId: r.assignedDriverId, startMs, endMs });
    if (startMs >= weekStart.getTime() && startMs < weekEnd.getTime()) {
      weekLoads[r.assignedDriverId] = (weekLoads[r.assignedDriverId] ?? 0) + 1;
    }
  }
  return { weekLoads, windows };
}

export { ACTIVE_STATES };
