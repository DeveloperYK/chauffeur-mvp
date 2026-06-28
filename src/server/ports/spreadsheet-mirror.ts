import { bookingRef } from '@/lib/booking-ref';
import { formatLondonDay, formatLondonTimeOfDay } from '@/lib/dates';
import type { Booking, Driver, Operator } from '@/server/db/schema';

/**
 * Columns A–R: the *input* columns of the JJ "Main Data" workbook, grouped as
 * the operators know them — Step 1 Job Details (A–L), Step 2 Job Allocation
 * (M–O) and Step 3 Job Completion (P–R). The mirror writes only these.
 *
 * Everything to the right is left for the operators' own template: the manual
 * Accounting flags (S–T "Raise an invoice?" / "Invoiced by Driver?") and the
 * "Auto-Calculations (don't touch!)" columns (U–AD), which are sheet formulas.
 * The mirror never touches columns beyond R, so it can't clobber them.
 */
export const SHEET_HEADERS = [
  'Job #', // A
  'Date', // B
  'Pick Up Time (24hr)', // C
  'Case Code', // D
  'Booked By', // E
  'Passenger FirstName', // F
  'Passenger LastName', // G
  'Address From', // H
  'Address To', // I
  'Customer Account', // J
  'Car Type', // K
  'Contract Price (£)', // L
  'Driver Name', // M
  'Driver Type', // N
  'Driver Cost (£)', // O
  'Car Park (£)', // P
  'Waiting Time (hh:mm)', // Q
  'Drop Off Time (24hr)', // R
] as const;

/** Last spreadsheet column the mirror writes (18 input columns → R). */
export const SHEET_LAST_COLUMN = 'R';

export interface MirrorRowInput {
  booking: Booking;
  driver?: Driver | null;
  operator?: Operator | null;
}

export interface SpreadsheetMirrorPort {
  upsertRow(input: MirrorRowInput): Promise<{ ok: true } | { ok: false; reason: string }>;
}

// The JJ sheet is a UK billing record — dates and times must be in Europe/London
// (BST-aware), not UTC.
function formatTimeOfDay(d: Date): string {
  return formatLondonTimeOfDay(d);
}

function formatDate(d: Date): string {
  return formatLondonDay(d);
}

function carLabel(c: string | null): string {
  if (!c) return '';
  const trimmed = c.trim();
  // Legacy enum aliases so old rows still display nicely.
  switch (trimmed) {
    case 'ex':
      return 'Executive';
    case 's_class':
      return 'Mercedes S-Class';
    case 'mpv':
      return 'MPV';
    case 'mini_bus':
      return 'Mini bus';
    default:
      return trimmed;
  }
}

/**
 * "Driver Type" (column N): a backfill job ran on an external subcontractor; an
 * internal assignment ran on an employee. Blank until a driver is on the job.
 */
function driverType(booking: Booking, driver: Driver | null | undefined): string {
  if (booking.isBackfill) return 'Subcontractor';
  return driver ? 'Employee' : '';
}

/** Pence → "£" string with 2 decimals; blank when null. */
function poundsOrBlank(pence: number | null): string {
  return pence != null ? (pence / 100).toFixed(2) : '';
}

/** Waiting minutes → "hh:mm"; blank when not recorded. */
function waitingHoursMinutes(waitingTimeMinutes: number | null): string {
  if (waitingTimeMinutes == null) return '';
  const hh = Math.floor(waitingTimeMinutes / 60)
    .toString()
    .padStart(2, '0');
  const mm = (waitingTimeMinutes % 60).toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

export function rowFromBooking(input: MirrorRowInput): string[] {
  const { booking, driver, operator } = input;
  // Car (column K): an internal driver brings the car + colour on their profile;
  // a backfill subcontractor's car is recorded on the booking. Empty until a
  // driver is assigned.
  const car = booking.isBackfill
    ? carLabel(booking.backfillCar)
    : [driver?.carColour?.trim(), carLabel(driver?.car ?? null)].filter(Boolean).join(' ');
  // Driver Name (column M): a backfill name lives on the booking; an internal
  // driver's name is on the driver record.
  const driverName = booking.isBackfill ? (booking.backfillDriverName ?? '') : (driver?.name ?? '');
  const pickup = booking.pickupAt;

  return [
    bookingRef(booking.seq), // A Job #
    formatDate(pickup), // B Date
    formatTimeOfDay(pickup), // C Pick Up Time (24hr)
    booking.caseCode ?? '', // D Case Code
    operator?.name ?? '', // E Booked By
    booking.passengerFirstName, // F Passenger FirstName
    booking.passengerLastName ?? '', // G Passenger LastName
    booking.pickupAddress, // H Address From
    // Hourly as-directed jobs have no destination — the sheet shows "As directed".
    booking.dropoffAddress ?? 'As directed', // I Address To
    booking.accountCode, // J Customer Account
    car, // K Car Type
    (booking.contractPricePence / 100).toFixed(2), // L Contract Price (£)
    driverName, // M Driver Name
    driverType(booking, driver), // N Driver Type
    poundsOrBlank(booking.backfillDriverPayPence), // O Driver Cost (£) — subcontractor pay
    poundsOrBlank(booking.carParkPence), // P Car Park (£)
    waitingHoursMinutes(booking.waitingTimeMinutes), // Q Waiting Time (hh:mm)
    booking.dropoffAt ? formatTimeOfDay(booking.dropoffAt) : '', // R Drop Off Time (24hr)
  ];
}
