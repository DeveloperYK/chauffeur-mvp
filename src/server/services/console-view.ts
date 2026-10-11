import type {
  AssignmentWindow,
  ConsoleBooking,
  ConsoleDriver,
  ConsoleOperator,
} from '@/components/console/types';
import type { Database } from '@/server/db';
import { type Booking, bookings } from '@/server/db/schema';
import { waitingFee } from '@/server/domain/waiting-fee';
import { eq } from 'drizzle-orm';
import {
  driverDispatchData,
  listBookingsByState,
  listBookingsForDay,
  listDriverNotToldBookings,
} from './bookings-query';
import { listAllDrivers } from './drivers';
import { type ExecEmailSends, execEmailSendMap } from './exec-notifications';
import { type OpenOfferDriver, openOffersForBookings } from './offers';
import { listOperators } from './operators';

/**
 * Read models for the console surfaces. The board and the mobile shell render
 * the same serialised booking (ISO dates, derived waiting fee, open offers,
 * email send state) so that the shared modals — dispatch, edit, cancel — work
 * identically on both. The shapes themselves live with the client components
 * (`components/console/types`); only type imports cross that line.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function toConsoleBooking(
  b: Booking,
  openOffers: OpenOfferDriver[] = [],
  emailSends?: Map<string, ExecEmailSends>,
): ConsoleBooking {
  const fee = waitingFee(b.waitingTimeMinutes);
  const sends = emailSends?.get(b.id);
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  return {
    id: b.id,
    seq: b.seq,
    state: b.state,
    pickupAt: b.pickupAt.toISOString(),
    expectedDurationMinutes: b.expectedDurationMinutes,
    serviceType: b.serviceType,
    distanceMeters: b.distanceMeters,
    travelMode: b.travelMode,
    travelRef: b.travelRef,
    requestedCarType: b.requestedCarType,
    pickupAddress: b.pickupAddress,
    dropoffAddress: b.dropoffAddress ?? '',
    passengerFirstName: b.passengerFirstName,
    passengerLastName: b.passengerLastName,
    execMobile: b.execMobile,
    execEmail: b.execEmail,
    bookedByName: b.bookedByName,
    confirmationEmailSentAt: iso(sends?.confirmationSentAt ?? null),
    driverDetailsEmailSentAt: iso(sends?.driverDetailsSentAt ?? null),
    changeUpdateEmailSentAt: iso(sends?.changeUpdateSentAt ?? null),
    changeExecRelevant: b.changeExecRelevant,
    bookedByPhone: b.bookedByPhone,
    bookedByEmail: b.bookedByEmail,
    clientName: b.clientName,
    accountCode: b.accountCode,
    caseCode: b.caseCode,
    contractPricePence: b.contractPricePence,
    subcontractorPricePence: b.subcontractorPricePence,
    notes: b.notes,
    operatorNotes: b.operatorNotes,
    createdByOperatorId: b.createdByOperatorId,
    assignedOperatorId: b.assignedOperatorId,
    assignedDriverId: b.assignedDriverId,
    assignmentMethod: b.assignmentMethod,
    isBackfill: b.isBackfill,
    backfillDriverName: b.backfillDriverName,
    backfillDriverPhone: b.backfillDriverPhone,
    backfillCar: b.backfillCar,
    backfillDriverPayPence: b.backfillDriverPayPence,
    completionByOperator: b.completionByOperator,
    execNotificationStatus: b.execNotificationStatus,
    mirrorStatus: b.mirrorStatus,
    mirroredAt: iso(b.mirroredAt),
    carParkPence: b.carParkPence,
    waitingTimeMinutes: b.waitingTimeMinutes,
    arrivalAt: iso(b.arrivalAt),
    passengerOnBoardAt: iso(b.passengerOnBoardAt),
    waitingFee: {
      chargeableMinutes: fee.chargeableMinutes,
      // Effective charge: operator override if set, else the computed £1/min fee.
      customerFeePence: b.waitingChargePence ?? fee.customerFeePence,
      driverPayPence: fee.driverPayPence,
    },
    waitingChargePence: b.waitingChargePence,
    dropoffAt: iso(b.dropoffAt),
    cancelledAt: iso(b.cancelledAt),
    cancellationReason: b.cancellationReason,
    flaggedAt: iso(b.flaggedAt),
    changeConfirmationStatus: b.changeConfirmationStatus,
    changeConfirmedMethod: b.changeConfirmedMethod,
    changeConfirmedAt: iso(b.changeConfirmedAt),
    openOffers,
  };
}

export function toConsoleDriver(
  d: Awaited<ReturnType<typeof listAllDrivers>>[number],
): ConsoleDriver {
  return {
    id: d.id,
    name: d.name,
    vehicleClass: d.vehicleClass,
    car: d.car,
    carColour: d.carColour,
    whatsappNumber: d.whatsappNumber,
    active: d.active,
  };
}

async function roster(
  db: Database,
): Promise<{ drivers: ConsoleDriver[]; operators: ConsoleOperator[] }> {
  const [driverRows, operatorRows] = await Promise.all([listAllDrivers(db), listOperators(db)]);
  return {
    drivers: driverRows.map(toConsoleDriver),
    operators: operatorRows.map((o) => ({ id: o.id, name: o.name })),
  };
}

export interface BookingView {
  booking: ConsoleBooking;
  drivers: ConsoleDriver[];
  operators: ConsoleOperator[];
  /** Every active assignment's window — the dispatch modal's busy flags. */
  assignments: AssignmentWindow[];
}

/** One booking with everything the mobile booking screen (and its modals) needs. */
export async function loadBookingView(db: Database, id: string): Promise<BookingView | null> {
  if (!UUID.test(id)) return null;
  const [row] = await db.select().from(bookings).where(eq(bookings.id, id)).limit(1);
  if (!row) return null;
  const [offers, sends, people, dispatch] = await Promise.all([
    openOffersForBookings(db, row.state === 'unassigned' ? [row.id] : []),
    execEmailSendMap(db, [row.id]),
    roster(db),
    driverDispatchData(db),
  ]);
  return {
    booking: toConsoleBooking(row, offers.get(row.id) ?? [], sends),
    drivers: people.drivers,
    operators: people.operators,
    assignments: dispatch.windows,
  };
}

export interface DayView {
  bookings: ConsoleBooking[];
  drivers: ConsoleDriver[];
  operators: ConsoleOperator[];
}

/** A London day's bookings, pickup order, for the mobile day list. */
export async function loadDayView(db: Database, day: string): Promise<DayView> {
  const [rows, people] = await Promise.all([listBookingsForDay(db, day), roster(db)]);
  const unassignedIds = rows.filter((b) => b.state === 'unassigned').map((b) => b.id);
  const offers = await openOffersForBookings(db, unassignedIds);
  return {
    bookings: rows.map((b) => toConsoleBooking(b, offers.get(b.id) ?? [])),
    drivers: people.drivers,
    operators: people.operators,
  };
}

/**
 * Everything that needs an operator, across every day: bookings with no
 * driver, completions awaiting review, and dispatched bookings whose driver
 * has not confirmed a change. The mobile shell's "needs attention" list.
 */
export async function loadAttentionView(db: Database): Promise<DayView> {
  const [open, review, notTold, people] = await Promise.all([
    listBookingsByState(db, 'unassigned'),
    listBookingsByState(db, 'awaiting_operator_review'),
    listDriverNotToldBookings(db),
    roster(db),
  ]);
  const byId = new Map<string, Booking>();
  for (const b of [...open, ...review, ...notTold]) byId.set(b.id, b);
  const rows = [...byId.values()].sort((a, b) => a.pickupAt.getTime() - b.pickupAt.getTime());
  const offers = await openOffersForBookings(
    db,
    rows.filter((b) => b.state === 'unassigned').map((b) => b.id),
  );
  return {
    bookings: rows.map((b) => toConsoleBooking(b, offers.get(b.id) ?? [])),
    drivers: people.drivers,
    operators: people.operators,
  };
}
