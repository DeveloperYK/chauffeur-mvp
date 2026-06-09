import { parseBookingQuery } from '@/lib/booking-ref';
import {
  formatLondonDay,
  formatLondonMonthShort,
  londonDayRangeUtc,
  londonMonthRangeUtc,
  offsetMonth,
} from '@/lib/dates';
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

/** Completed bookings whose pickup falls in the given London month (YYYY-MM).
 *  The billable set for the monthly reconciliation report. */
export async function listBillableBookings(db: Database, monthStr: string): Promise<Booking[]> {
  const range = londonMonthRangeUtc(monthStr);
  if (!range) return [];
  return db
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.state, 'completed'),
        gte(bookings.pickupAt, range.startUtc),
        lt(bookings.pickupAt, range.endUtc),
      ),
    )
    .orderBy(asc(bookings.pickupAt))
    .limit(5000);
}

/** How many months before the target month the account suggestions look back. */
export const ACCOUNT_SUGGESTION_LOOKBACK_MONTHS = 3;
/** Cap on the number of distinct accounts returned to the autocomplete. */
const ACCOUNT_SUGGESTION_LIMIT = 50;

export interface AccountSuggestion {
  /** The account-code string exactly as stored, so picking it reuses the spelling. */
  account: string;
  /** Short London month of the account's most recent use in the window, e.g. "Jun". */
  monthLabel: string;
  /** True if the account was already used in the target (pickup) month. */
  inMonth: boolean;
}

/**
 * Distinct customer-account strings to offer the create/edit booking form, so
 * operators reuse an existing spelling instead of retyping (which fragments the
 * monthly invoice — see {@link reconcile}, which groups on the exact string).
 *
 * Sourced from the target month plus {@link ACCOUNT_SUGGESTION_LOOKBACK_MONTHS}
 * prior months (so a brand-new month still autocompletes from recent history),
 * across every booking state. Target-month accounts come first, then the rest by
 * most-recent use. Returns `[]` for an invalid month.
 */
export async function listAccountCodeSuggestions(
  db: Database,
  monthStr: string,
): Promise<AccountSuggestion[]> {
  const monthRange = londonMonthRangeUtc(monthStr);
  if (!monthRange) return [];
  const windowStart = londonMonthRangeUtc(
    offsetMonth(monthStr, -ACCOUNT_SUGGESTION_LOOKBACK_MONTHS),
  );
  if (!windowStart) return [];

  // Newest first so the first time we see an account is its most-recent use.
  const rows = await db
    .select({ account: bookings.accountCode, pickupAt: bookings.pickupAt })
    .from(bookings)
    .where(
      and(gte(bookings.pickupAt, windowStart.startUtc), lt(bookings.pickupAt, monthRange.endUtc)),
    )
    .orderBy(desc(bookings.pickupAt))
    .limit(5000);

  const lastUsed = new Map<string, Date>();
  for (const row of rows) {
    const account = row.account.trim();
    if (account.length === 0 || lastUsed.has(account)) continue;
    lastUsed.set(account, row.pickupAt);
  }

  const suggestions: AccountSuggestion[] = [...lastUsed].map(([account, at]) => ({
    account,
    monthLabel: formatLondonMonthShort(at),
    inMonth: at >= monthRange.startUtc,
  }));

  // Target-month accounts first, then by most-recent use, ties broken by name.
  suggestions.sort((a, b) => {
    if (a.inMonth !== b.inMonth) return a.inMonth ? -1 : 1;
    const at = lastUsed.get(a.account);
    const bt = lastUsed.get(b.account);
    if (at && bt && at.getTime() !== bt.getTime()) return bt.getTime() - at.getTime();
    return a.account.localeCompare(b.account);
  });

  return suggestions.slice(0, ACCOUNT_SUGGESTION_LIMIT);
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

/** Minimum digit count before a bare number is treated as a phone, not a booking ref. */
const PHONE_MIN_DIGITS = 7;

/**
 * A query is "phone-like" when it is only phone characters (digits plus the
 * usual `+ ( ) - ` separators) and carries at least {@link PHONE_MIN_DIGITS}
 * digits. This keeps short refs like `42` / `00042` as exact booking-ID lookups
 * while routing real phone numbers to the digit-normalised match below.
 */
function isPhoneLike(q: string): boolean {
  if (!/^[\d\s+()-]+$/.test(q)) return false;
  return q.replace(/\D/g, '').length >= PHONE_MIN_DIGITS;
}

/**
 * Digit-normalised phone match for one token: compares the token's digits
 * against `exec_mobile` stripped of all non-digits, so formatting differs
 * freely. A single UK trunk `0` is dropped from the token so `07911…` matches a
 * stored `+447911…`. Returns undefined for tokens too short to be a phone, so
 * stray numbers in a name search don't drag in unrelated bookings.
 */
function phoneDigitsMatch(token: string): SQL | undefined {
  const digits = token.replace(/\D/g, '');
  if (digits.length < 4) return undefined;
  const normalized = digits.replace(/^0/, '');
  return sql`regexp_replace(${bookings.execMobile}, '[^0-9]', '', 'g') like ${`%${normalized}%`}`;
}

/** OR across every searchable field for a single whitespace-delimited token. */
function tokenMatch(token: string): SQL | undefined {
  const pattern = likeContains(token);
  return or(
    ilike(bookings.passengerFirstName, pattern),
    ilike(bookings.passengerLastName, pattern),
    ilike(drivers.name, pattern),
    ilike(bookings.pickupAddress, pattern),
    ilike(bookings.dropoffAddress, pattern),
    ilike(bookings.accountCode, pattern),
    ilike(bookings.caseCode, pattern),
    ilike(bookings.carForThisJob, pattern),
    ilike(bookings.clientName, pattern),
    ilike(bookings.execMobile, pattern),
    phoneDigitsMatch(token),
  );
}

/**
 * Global booking search for the command palette. Matches:
 * - the exact booking reference (`seq`) when the query is a short ID
 *   (`42` / `00042` / `BKNG-00042`), otherwise
 * - every whitespace-delimited word as a case-insensitive substring (AND across
 *   words, OR across fields) over passenger name, assigned driver name,
 *   pickup/dropoff address, account code, case code, vehicle, client/company
 *   name, and exec phone. Multi-word so a full name ("Eric French") matches
 *   first+last; a 7+ digit number is treated as a phone (digit-normalised, UK
 *   leading zero tolerated), not a booking ID.
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
    const tokens = q.split(/\s+/).filter(Boolean);
    const seq = tokens.length === 1 ? parseBookingQuery(q) : null;
    if (seq !== null && !isPhoneLike(q)) {
      conditions.push(eq(bookings.seq, seq));
    } else {
      // Each word must match somewhere; AND the per-word OR-groups together.
      for (const token of tokens) {
        const term = tokenMatch(token);
        if (term) conditions.push(term);
      }
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
