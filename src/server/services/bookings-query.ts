import type { Database } from '@/server/db';
import { type Booking, type BookingState, bookings } from '@/server/db/schema';
import { asc, desc } from 'drizzle-orm';

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

export { ACTIVE_STATES };
