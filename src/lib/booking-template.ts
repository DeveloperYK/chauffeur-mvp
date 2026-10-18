/**
 * "Copy booking": the fields of a past booking that carry over into a new
 * create form. Operators re-book the same jobs week after week (same exec and
 * PA, same route, same price), so a copy pre-fills everything that describes
 * the job and leaves blank what belongs to the new occurrence — pickup time,
 * driver, state, and every completion figure.
 *
 * Pure and shared by the client (copying from the open detail panel) and the
 * server (copying from a booking picked by search).
 */

export type ServiceTypeValue = 'transfer' | 'hourly';
export type TravelModeValue = 'flight' | 'train';

/** The subset of a booking the template reads; satisfied by both the DB row
 * and the console's serialised booking. */
export interface TemplateSource {
  serviceType: ServiceTypeValue;
  travelMode: TravelModeValue | null;
  travelRef: string | null;
  requestedCarType: string | null;
  expectedDurationMinutes: number;
  distanceMeters: number | null;
  pickupAddress: string;
  dropoffAddress: string | null;
  passengerFirstName: string;
  passengerLastName: string | null;
  execMobile: string | null;
  execEmail: string | null;
  bookedByName: string | null;
  bookedByPhone: string | null;
  bookedByEmail: string | null;
  clientName: string | null;
  accountCode: string | null;
  caseCode: string | null;
  contractPricePence: number | null;
  subcontractorPricePence: number | null;
  notes: string | null;
  operatorNotes: string | null;
}

/** Exactly the create form's reusable fields, in the form's own value types. */
export interface BookingTemplate {
  serviceType: ServiceTypeValue;
  travelMode: '' | TravelModeValue;
  travelRef: string;
  requestedCarType: string;
  expectedDurationMinutes: number;
  distanceMeters: number | null;
  pickupAddress: string;
  dropoffAddress: string;
  passengerFirstName: string;
  passengerLastName: string;
  execMobile: string;
  execEmail: string;
  bookedByName: string;
  bookedByPhone: string;
  bookedByEmail: string;
  customerAccount: string;
  caseCode: string;
  contractPricePounds: string;
  subcontractorPricePounds: string;
  notes: string;
  operatorNotes: string;
}

/** Pence → the pounds string the price inputs hold ("165.5", "300", ""). */
const poundsField = (pence: number | null): string => (pence == null ? '' : String(pence / 100));

export function templateFromBooking(b: TemplateSource): BookingTemplate {
  return {
    serviceType: b.serviceType,
    travelMode: b.travelMode ?? '',
    travelRef: b.travelRef ?? '',
    requestedCarType: b.requestedCarType ?? '',
    expectedDurationMinutes: b.expectedDurationMinutes,
    distanceMeters: b.distanceMeters,
    pickupAddress: b.pickupAddress,
    dropoffAddress: b.dropoffAddress ?? '',
    passengerFirstName: b.passengerFirstName,
    passengerLastName: b.passengerLastName ?? '',
    execMobile: b.execMobile ?? '',
    execEmail: b.execEmail ?? '',
    bookedByName: b.bookedByName ?? '',
    bookedByPhone: b.bookedByPhone ?? '',
    bookedByEmail: b.bookedByEmail ?? '',
    customerAccount: b.accountCode ?? b.clientName ?? '',
    caseCode: b.caseCode ?? '',
    contractPricePounds: poundsField(b.contractPricePence),
    subcontractorPricePounds: poundsField(b.subcontractorPricePence),
    notes: b.notes ?? '',
    operatorNotes: b.operatorNotes ?? '',
  };
}
