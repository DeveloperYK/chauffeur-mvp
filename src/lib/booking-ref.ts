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
