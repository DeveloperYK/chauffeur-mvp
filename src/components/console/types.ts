import type {
  BookingState,
  ChangeConfirmationStatus,
  ConfirmationMethod,
  ExecNotificationStatus,
  MirrorStatus,
  VehicleClass,
} from '@/server/db/schema';

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
  /** Optional flight/train the passenger arrives on (paired; null when unset). */
  travelMode: 'flight' | 'train' | null;
  travelRef: string | null;
  pickupAddress: string;
  /** Empty string for hourly as-directed bookings (no destination). */
  dropoffAddress: string;
  passengerFirstName: string;
  passengerLastName: string | null;
  execMobile: string;
  /** Exec email — recipient when the email channel is active; null if not captured. */
  execEmail: string | null;
  /** Customer Account — the company billed (stored in account_code). */
  clientName: string;
  accountCode: string;
  /** Case code — expense code the customer's company bills against. */
  caseCode: string | null;
  contractPricePence: number;
  /** Driver-facing notes — shown to the driver on the dispatch link page. */
  notes: string | null;
  /** Operator-only notes — never shown to the driver. */
  operatorNotes: string | null;
  createdByOperatorId: string | null;
  assignedOperatorId: string | null;
  assignedDriverId: string | null;
  /** How the assigned driver was committed: link-accept (driver_self) vs operator phone-attest. */
  assignmentMethod: ConfirmationMethod | null;
  /**
   * Cached health of automated exec messages for this booking. `failed` drives
   * the red indicator on the tile; `pending` (email accepted, not yet confirmed)
   * shows only in the detail panel. See exec-messages shaping.
   */
  execNotificationStatus: ExecNotificationStatus;
  /**
   * Health of this booking's row in the Sheets backup mirror. `failed` means
   * the last write didn't land — the sheet may be stale for this booking.
   */
  mirrorStatus: MirrorStatus;
  /** When the last mirror write was attempted (ISO), null if never. */
  mirroredAt: string | null;
  /** True when the job is covered by a backfill (subcontractor) driver, not the internal roster. */
  isBackfill: boolean;
  /** Operator-entered backfill driver name (only when isBackfill). */
  backfillDriverName: string | null;
  /** Operator-entered backfill driver phone (only when isBackfill). */
  backfillDriverPhone: string | null;
  /** Operator-entered backfill driver's car (only when isBackfill). */
  backfillCar: string | null;
  /** What the backfill driver is paid for this job, in pence (only when isBackfill). */
  backfillDriverPayPence: number | null;
  /** True when the operator entered the completion form on the driver's behalf (skipped review). */
  completionByOperator: boolean;
  carParkPence: number | null;
  /** Waiting minutes reported by the driver, null until the form is in. */
  waitingTimeMinutes: number | null;
  /**
   * Waiting charge resolved server-side: `customerFeePence` is the *effective*
   * charge (operator override if set, else the computed £1/min fee). Always
   * present; zero when there's no chargeable waiting.
   */
  waitingFee: {
    chargeableMinutes: number;
    customerFeePence: number;
    driverPayPence: number;
  };
  /** Operator override of the waiting charge (pence), or null when auto (£1/min). */
  waitingChargePence: number | null;
  dropoffAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  flaggedAt: string | null;
  /**
   * Mid-flight change confirmation. `pending` after a driver-facing edit on an
   * already-dispatched booking until the driver confirms (by phone-attest or by
   * tapping their link). Drives the "change — driver not confirmed" badge.
   */
  changeConfirmationStatus: ChangeConfirmationStatus;
  /** How the latest change was confirmed; null while none/pending. */
  changeConfirmedMethod: ConfirmationMethod | null;
  /** When the latest change was confirmed (ISO); null while none/pending. */
  changeConfirmedAt: string | null;
  /**
   * Drivers with an open (awaiting) dispatch offer on this booking — the
   * operator has sent them a link but none has accepted yet. Empty unless the
   * booking is unassigned. Drives the "Offered to N · awaiting" badge.
   */
  openOffers: { driverId: string; driverName: string }[];
}

export interface ConsoleDriver {
  id: string;
  name: string;
  vehicleClass: VehicleClass;
  car: string;
  carColour: string;
  whatsappNumber: string;
  active: boolean;
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
