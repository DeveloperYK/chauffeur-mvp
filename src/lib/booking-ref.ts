/**
 * Human-readable booking reference derived from the booking's sequence number.
 *
 * Format lives here so it can change in one place: seq `1` → `BKNG-00001`.
 * Exposed in the UI and in every customer/driver message so anyone can quote
 * the reference and we can trace it straight back to the booking.
 */
export const BOOKING_REF_PREFIX = 'BKNG';

const MIN_DIGITS = 5;

export function bookingRef(seq: number): string {
  const n = Number.isFinite(seq) && seq > 0 ? Math.floor(seq) : 0;
  return `${BOOKING_REF_PREFIX}-${String(n).padStart(MIN_DIGITS, '0')}`;
}

/**
 * Interpret a search query as a booking ID, if it looks like one.
 *
 * The whole query (after trimming, lowercasing, and stripping an optional
 * `BKNG-` prefix) must be digits — so `42`, `00042`, `BKNG-00042`, and `bkng42`
 * all resolve to seq `42`, while `marcus`, `42 King St`, and `0` return null
 * (the latter because seq is 1-based). Lets the search treat a bare number as
 * an exact reference hit without changing the displayed `BKNG-` format.
 */
export function parseBookingQuery(query: string): number | null {
  const stripped = query
    .trim()
    .toLowerCase()
    .replace(new RegExp(`^${BOOKING_REF_PREFIX.toLowerCase()}[-\\s]*`), '');
  if (!/^\d+$/.test(stripped)) return null;
  const n = Number.parseInt(stripped, 10);
  return n > 0 ? n : null;
}
