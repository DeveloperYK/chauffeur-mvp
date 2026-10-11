import type { BookingState, ChangeConfirmationStatus } from '@/server/db/schema';

/**
 * How the mobile shell lays out a day: what needs the operator first, then
 * the jobs that are running as planned, then what is finished. The operator on
 * a phone is there to deal with a problem, not to survey the board, so the
 * problems come first.
 */

export interface SectionableBooking {
  id: string;
  state: BookingState;
  pickupAt: string;
  changeConfirmationStatus: ChangeConfirmationStatus;
  openOffers: { driverId: string; driverName: string }[];
}

export interface DaySections<T extends SectionableBooking> {
  attention: T[];
  scheduled: T[];
  done: T[];
}

const DONE_STATES: readonly BookingState[] = ['completed', 'cancelled'];

/** Why a booking is in the attention section, or null when it is fine. */
export function attentionReason(b: SectionableBooking): string | null {
  if (b.state === 'unassigned') {
    const n = b.openOffers.length;
    return n > 0 ? `Offered to ${n} · awaiting reply` : 'Needs a driver';
  }
  if (b.state === 'awaiting_operator_review') return 'Review completion';
  if (b.changeConfirmationStatus === 'pending' && !DONE_STATES.includes(b.state)) {
    return 'Driver not told of change';
  }
  return null;
}

function byPickup<T extends SectionableBooking>(a: T, b: T): number {
  return a.pickupAt.localeCompare(b.pickupAt);
}

export function sectionBookingsForDay<T extends SectionableBooking>(
  bookings: readonly T[],
): DaySections<T> {
  const sorted = [...bookings].sort(byPickup);
  return {
    attention: sorted.filter((b) => attentionReason(b) !== null),
    scheduled: sorted.filter((b) => attentionReason(b) === null && !DONE_STATES.includes(b.state)),
    done: sorted.filter((b) => DONE_STATES.includes(b.state)),
  };
}
