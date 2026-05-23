import type { BookingState, DriverTier } from '@/server/db/schema';

// Serializable shapes passed from the board server component into the client
// console shell. Dates are ISO strings so the client formats them consistently.

export interface ConsoleBooking {
  id: string;
  state: BookingState;
  pickupAt: string;
  expectedDurationMinutes: number;
  pickupAddress: string;
  dropoffAddress: string;
  passengerFirstName: string;
  passengerLastName: string | null;
  execMobile: string;
  clientName: string;
  accountCode: string;
  contractPricePence: number;
  notes: string | null;
  createdByOperatorId: string | null;
  assignedOperatorId: string | null;
  assignedDriverId: string | null;
  carForThisJob: string | null;
  carParkPence: number | null;
  waitingTimeMinutes: number | null;
  dropoffAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  flaggedAt: string | null;
}

export interface ConsoleDriver {
  id: string;
  name: string;
  tier: DriverTier;
  defaultCarType: string;
  whatsappNumber: string;
  active: boolean;
  /** Derived: count of this driver's open bookings in the current week. */
  jobsThisWeek: number;
}

export interface ConsoleOperator {
  id: string;
  name: string;
}

/** A driver's busy window — used to flag overlap with the booking being dispatched. */
export interface AssignmentWindow {
  driverId: string;
  startMs: number;
  endMs: number;
}
