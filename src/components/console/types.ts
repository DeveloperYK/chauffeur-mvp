import type { BookingState, DriverTier } from '@/server/db/schema';

// Serializable shapes passed from the board server component into the client
// console shell. Dates are ISO strings so the client formats them consistently.

export interface ConsoleBooking {
  id: string;
  /** Auto-incrementing reference number; rendered as "BKNG-00001". */
  seq: number;
  state: BookingState;
  serviceType: 'transfer' | 'hourly';
  pickupAt: string;
  expectedDurationMinutes: number;
  distanceMeters: number | null;
  pickupAddress: string;
  /** Empty string for hourly as-directed bookings (no destination). */
  dropoffAddress: string;
  passengerFirstName: string;
  passengerLastName: string | null;
  execMobile: string;
  /** Customer Account — the company billed (stored in account_code). */
  clientName: string;
  accountCode: string;
  /** Case code — expense code the customer's company bills against. */
  caseCode: string | null;
  contractPricePence: number;
  notes: string | null;
  createdByOperatorId: string | null;
  assignedOperatorId: string | null;
  assignedDriverId: string | null;
  carForThisJob: string | null;
  carParkPence: number | null;
  waitingTimeMinutes: number | null;
  /**
   * Waiting charge computed live (server-side) from `waitingTimeMinutes`.
   * Always present; all-zero when no chargeable waiting. Lets the panel show
   * the customer fee and the driver's share without importing server domain.
   */
  waitingFee: {
    chargeableMinutes: number;
    customerFeePence: number;
    driverPayPence: number;
  };
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
