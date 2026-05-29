import { bookingRef } from '@/lib/booking-ref';
import { formatLondonDay, formatLondonTimeOfDay } from '@/lib/dates';
import type { Booking, Driver, Operator } from '@/server/db/schema';
import { waitingFee } from '@/server/domain/waiting-fee';

/** Columns A–AD from the existing JJ DATA workbook. */
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
  'Hourly Rate', // O — reserved
  'Car Park (£)', // P
  'Waiting Time (hh:mm)', // Q
  'Drop Off Time (24hr)', // R
  'Raise an invoice??', // S
  'Invoiced by Driver?', // T
  'Passenger Name', // U
  'Total Trip Time', // V
  'Trip Details From To', // W
  'Waiting (£)', // X
  'Net Due (£)', // Y
  'VAT (£)', // Z
  'Total (£)', // AA
  'Sub-contractor Cost', // AB
  'Month', // AC
  'WeekDay', // AD
] as const;

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

function tierLabel(t: string | null): string {
  if (t === 'premium') return 'Employee';
  if (t === 'ordinary') return 'Employee';
  return '';
}

export function rowFromBooking(input: MirrorRowInput): string[] {
  const { booking, driver, operator } = input;
  // Vehicle is whatever the driver brings (set at accept); empty until then.
  const car = booking.carForThisJob ?? '';
  const pickup = booking.pickupAt;
  const dropoff = booking.dropoffAt;
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
    carLabel(car),
    (booking.contractPricePence / 100).toFixed(2),
    driver?.name ?? '',
    tierLabel(driver?.tier ?? null),
    '', // hourly rate
    booking.carParkPence != null ? (booking.carParkPence / 100).toFixed(2) : '',
    booking.waitingTimeMinutes != null
      ? `${Math.floor(booking.waitingTimeMinutes / 60)
          .toString()
          .padStart(2, '0')}:${(booking.waitingTimeMinutes % 60).toString().padStart(2, '0')}`
      : '',
    dropoff ? formatTimeOfDay(dropoff) : '',
    booking.state === 'completed' ? 'Yes' : 'No',
    '',
    `${booking.passengerFirstName}${booking.passengerLastName ? ` ${booking.passengerLastName}` : ''}`,
    `${totalMinutes} min`,
    `${booking.pickupAddress} → ${booking.dropoffAddress}`,
    // Waiting (£) — computed live from the reported waiting minutes; blank when
    // none is chargeable. Net Due / VAT / Total stay blank for the sheet's own
    // formulas (see docs/shaping/invoicing-reporting.md).
    waitingPounds(booking.waitingTimeMinutes),
    '', // Net Due (£)
    '', // VAT (£)
    '', // Total (£)
    '', // Sub-contractor Cost
    pickup.toLocaleString('en-GB', { month: 'long', timeZone: 'Europe/London' }),
    pickup.toLocaleString('en-GB', { weekday: 'long', timeZone: 'Europe/London' }),
  ];
}
