import type { ConsoleBooking, ConsoleDriver } from '@/components/console/types';
import type { Booking } from '@/server/db/schema';
import { waitingFee } from '@/server/domain/waiting-fee';
import type { listAllDrivers } from './drivers';
import type { ExecEmailSends } from './exec-notifications';
import type { OpenOfferDriver } from './offers';

/**
 * The board's read model: a booking row serialised for the client console
 * (ISO dates, derived waiting fee, open offers, email send state). The shapes
 * live with the client components (`components/console/types`); only type
 * imports cross that line.
 */

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
