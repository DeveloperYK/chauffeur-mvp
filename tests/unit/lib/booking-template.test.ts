import { templateFromBooking } from '@/lib/booking-template';
import { describe, expect, it } from 'vitest';

/**
 * Operators re-book the same jobs week after week (same exec + PA, same
 * route, same price). "Copy booking" pre-fills the create form from a past
 * booking; this mapping decides exactly which fields carry over and which
 * belong to the new job and must start blank.
 */
const completedTransfer = {
  serviceType: 'transfer' as const,
  travelMode: 'flight' as const,
  travelRef: 'BA268',
  requestedCarType: 'vip',
  expectedDurationMinutes: 75,
  distanceMeters: 24_500,
  pickupAddress: 'The Connaught, Carlos Place, London W1K 2AL',
  dropoffAddress: 'Heathrow Terminal 5, Departures',
  passengerFirstName: 'Alexander',
  passengerLastName: 'Pemberton',
  execMobile: '+447911123456',
  execEmail: 'alex@pemberton.com',
  bookedByName: 'Sandra Miles',
  bookedByPhone: '+447700123456',
  bookedByEmail: 'sandra@pemberton.com',
  clientName: 'Pemberton Capital',
  accountCode: 'Pemberton Capital',
  caseCode: 'PEMB-2026-0142',
  contractPricePence: 16_550,
  subcontractorPricePence: 12_000,
  notes: 'Two large suitcases.',
  operatorNotes: 'Confirm PO before dispatch.',
};

describe('templateFromBooking', () => {
  it('carries over the people, route, codes, price and notes of a transfer', () => {
    expect(templateFromBooking(completedTransfer)).toEqual({
      serviceType: 'transfer',
      travelMode: 'flight',
      travelRef: 'BA268',
      requestedCarType: 'vip',
      expectedDurationMinutes: 75,
      distanceMeters: 24_500,
      pickupAddress: 'The Connaught, Carlos Place, London W1K 2AL',
      dropoffAddress: 'Heathrow Terminal 5, Departures',
      passengerFirstName: 'Alexander',
      passengerLastName: 'Pemberton',
      execMobile: '+447911123456',
      execEmail: 'alex@pemberton.com',
      bookedByName: 'Sandra Miles',
      bookedByPhone: '+447700123456',
      bookedByEmail: 'sandra@pemberton.com',
      customerAccount: 'Pemberton Capital',
      caseCode: 'PEMB-2026-0142',
      contractPricePounds: '165.5',
      subcontractorPricePounds: '120',
      notes: 'Two large suitcases.',
      operatorNotes: 'Confirm PO before dispatch.',
    });
  });

  it('maps an hourly booking with no destination to an empty drop-off', () => {
    const t = templateFromBooking({
      ...completedTransfer,
      serviceType: 'hourly',
      dropoffAddress: null,
      distanceMeters: null,
      expectedDurationMinutes: 240,
    });
    expect(t.serviceType).toBe('hourly');
    expect(t.dropoffAddress).toBe('');
    expect(t.distanceMeters).toBeNull();
    expect(t.expectedDurationMinutes).toBe(240);
  });

  it('turns every nullable field into the empty string the form expects', () => {
    const t = templateFromBooking({
      ...completedTransfer,
      travelMode: null,
      travelRef: null,
      requestedCarType: null,
      passengerLastName: null,
      execMobile: null,
      execEmail: null,
      bookedByName: null,
      bookedByPhone: null,
      bookedByEmail: null,
      clientName: null,
      accountCode: null,
      caseCode: null,
      contractPricePence: null,
      subcontractorPricePence: null,
      notes: null,
      operatorNotes: null,
    });
    expect(t).toMatchObject({
      travelMode: '',
      travelRef: '',
      requestedCarType: '',
      passengerLastName: '',
      execMobile: '',
      execEmail: '',
      bookedByName: '',
      bookedByPhone: '',
      bookedByEmail: '',
      customerAccount: '',
      caseCode: '',
      contractPricePounds: '',
      subcontractorPricePounds: '',
      notes: '',
      operatorNotes: '',
    });
  });

  it('falls back to the client name when there is no account code', () => {
    const t = templateFromBooking({ ...completedTransfer, accountCode: null });
    expect(t.customerAccount).toBe('Pemberton Capital');
  });

  it('never carries a pickup time, driver, state or completion data', () => {
    const t = templateFromBooking(completedTransfer) as unknown as Record<string, unknown>;
    for (const k of [
      'pickupAt',
      'state',
      'assignedDriverId',
      'waitingTimeMinutes',
      'waitingChargePence',
      'carParkPence',
      'dropoffAt',
      'id',
      'seq',
    ]) {
      expect(k in t, `${k} must not be copied`).toBe(false);
    }
  });

  it('writes a whole-pound price without a decimal part', () => {
    expect(
      templateFromBooking({ ...completedTransfer, contractPricePence: 30_000 }).contractPricePounds,
    ).toBe('300');
  });
});
