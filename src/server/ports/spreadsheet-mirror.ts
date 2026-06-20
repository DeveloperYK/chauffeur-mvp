import { bookingRef } from '@/lib/booking-ref';
import { formatLondonDay, formatLondonTimeOfDay } from '@/lib/dates';
import type { Booking, Driver, Operator } from '@/server/db/schema';
import { waitingFee } from '@/server/domain/waiting-fee';

/**
 * Columns A–AA matching the "Main Data" table in the current JJ workbook
 * (`JJ .xlsx`). The mirror reproduces this table exactly so the sheet is a
 * faithful, self-contained backup operators can fall back to.
 *
 * Changed from the previous layout: `Hourly Rate` is now `Driver Cost`, and the
 * three columns `Drop Off Time (24hr)`, `Raise an invoice??` and
 * `Invoiced by Driver?` were removed (everything after `Waiting Time` shifts
 * left by three). Billing-output columns (Driver Cost, Net Due, VAT, Total,
 * Sub-contractor Cost) are left blank for the operators' downstream invoicing.
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
  'Driver Cost', // O — reserved for downstream billing
  'Car Park (£)', // P
  'Waiting Time (hh:mm)', // Q
  'Passenger Name', // R
  'Total Trip Time', // S
  'Trip Details From To', // T
  'Waiting (£)', // U
  'Net Due (£)', // V
  'VAT (£)', // W
  'Total (£)', // X
  'Sub-contractor Cost', // Y
  'Month', // Z
  'WeekDay', // AA
] as const;

/** Last spreadsheet column letter for the table (27 columns → AA). */
export const SHEET_LAST_COLUMN = 'AA';

export interface MirrorRowInput {
  booking: Booking;
  driver?: Driver | null;
  operator?: Operator | null;
}

export interface SpreadsheetMirrorPort {
  upsertRow(input: MirrorRowInput): Promise<{ ok: true } | { ok: false; reason: string }>;
}

// The legacy JJ sheet is a UK billing record — dates and times must be in
// Europe/London (BST-aware), not UTC.
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

/** Waiting charge in pounds for the sheet's "Waiting (£)" column; blank when none. */
function waitingPounds(waitingTimeMinutes: number | null): string {
  const fee = waitingFee(waitingTimeMinutes).customerFeePence;
  return fee > 0 ? (fee / 100).toFixed(2) : '';
}

// "Driver Type" (column N) marks whether the job ran on an internal driver
// ("Employee") or an external backfill subcontractor (blank). It is not the
// vehicle class.
function employmentLabel(driver: Driver | null | undefined): string {
  return driver ? 'Employee' : '';
}

export function rowFromBooking(input: MirrorRowInput): string[] {
  const { booking, driver, operator } = input;
  // Car (column K): an internal driver brings the car + colour on their profile;
  // a backfill subcontractor's car is recorded on the booking. Empty until a
  // driver is assigned.
  const car = booking.isBackfill
    ? carLabel(booking.backfillCar)
    : [driver?.carColour?.trim(), carLabel(driver?.car ?? null)].filter(Boolean).join(' ');
  const pickup = booking.pickupAt;
  const totalMinutes = booking.dropoffAt
    ? Math.max(0, Math.round((booking.dropoffAt.getTime() - pickup.getTime()) / 60_000))
    : booking.expectedDurationMinutes;

  // Job # — the human-facing booking reference (e.g. "BKNG-00001").
  const jobNumber = bookingRef(booking.seq);
  return [
    jobNumber,
    formatDate(pickup),
    formatTimeOfDay(pickup),
    booking.caseCode ?? '', // Case code (legacy column D)
    operator?.name ?? '', // "Booked By" is now the operator who created it
    booking.passengerFirstName,
    booking.passengerLastName ?? '',
    booking.pickupAddress,
    // Hourly as-directed jobs have no destination — the sheet shows "As directed".
    booking.dropoffAddress ?? 'As directed',
    booking.accountCode,
    car,
    (booking.contractPricePence / 100).toFixed(2),
    driver?.name ?? '', // M Driver Name
    employmentLabel(driver), // N Driver Type
    '', // O Driver Cost — reserved for downstream billing
    booking.carParkPence != null ? (booking.carParkPence / 100).toFixed(2) : '', // P Car Park (£)
    booking.waitingTimeMinutes != null
      ? `${Math.floor(booking.waitingTimeMinutes / 60)
          .toString()
          .padStart(2, '0')}:${(booking.waitingTimeMinutes % 60).toString().padStart(2, '0')}`
      : '', // Q Waiting Time (hh:mm)
    `${booking.passengerFirstName}${booking.passengerLastName ? ` ${booking.passengerLastName}` : ''}`, // R Passenger Name
    `${totalMinutes} min`, // S Total Trip Time
    `${booking.pickupAddress} → ${booking.dropoffAddress}`, // T Trip Details From To
    // U Waiting (£) — computed live from the reported waiting minutes; blank when
    // none is chargeable. Driver Cost / Net Due / VAT / Total / Sub-contractor
    // Cost stay blank for the operators' downstream invoicing.
    waitingPounds(booking.waitingTimeMinutes),
    '', // V Net Due (£)
    '', // W VAT (£)
    '', // X Total (£)
    '', // Y Sub-contractor Cost
    pickup.toLocaleString('en-GB', { month: 'long', timeZone: 'Europe/London' }), // Z Month
    pickup.toLocaleString('en-GB', { weekday: 'long', timeZone: 'Europe/London' }), // AA WeekDay
  ];
}
