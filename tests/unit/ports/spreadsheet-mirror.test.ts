import { FakeSpreadsheetMirror } from '@/server/adapters/spreadsheet-mirror-fake';
import type { Booking, Driver } from '@/server/db/schema';
import {
  MONEY_COLUMN_INDICES,
  SHEET_HEADERS,
  SHEET_LAST_COLUMN,
  rowFromBooking,
} from '@/server/ports/spreadsheet-mirror';
import { describe, expect, it } from 'vitest';

const baseBooking: Booking = {
  id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  seq: 42,
  state: 'completed',
  mirrorStatus: 'none' as const,
  mirroredAt: null,
  serviceType: 'transfer',
  pickupAt: new Date('2026-06-01T08:30:00.000Z'),
  expectedDurationMinutes: 90,
  distanceMeters: 28000,
  travelMode: null,
  travelRef: null,
  requestedCarType: null,
  pickupAddress: '11 Belsize Park Gardens',
  dropoffAddress: 'LHR T5',
  passengerFirstName: 'Eric',
  passengerLastName: 'French',
  execMobile: '+447911999999',
  bookedByName: null,
  bookedByPhone: null,
  bookedByEmail: null,
  execEmail: null,
  clientName: 'LEGO Group',
  accountCode: 'LEGO',
  caseCode: 'LEGO-CASE-9',
  contractPricePence: 30000,
  notes: null,
  operatorNotes: null,
  createdByOperatorId: 'op-1',
  assignedOperatorId: 'op-1',
  assignedDriverId: 'driver-id-1',
  assignedAt: new Date('2026-06-01T07:00:00.000Z'),
  assignmentMethod: 'driver_self',
  carParkPence: 750,
  arrivalAt: new Date('2026-06-01T09:50:00.000Z'),
  passengerOnBoardAt: new Date('2026-06-01T10:02:00.000Z'),
  waitingTimeMinutes: 12,
  waitingChargePence: null,
  dropoffAt: new Date('2026-06-01T10:05:00.000Z'),
  completionSubmittedAt: new Date('2026-06-01T10:10:00.000Z'),
  completionLinkSentAt: null,
  confirmationEmailWaivedAt: null,
  driverDetailsEmailWaivedAt: null,
  changeUpdateEmailWaivedAt: null,
  approvedAt: new Date('2026-06-01T10:15:00.000Z'),
  approvedByOperatorId: 'op-1',
  cancelledAt: null,
  cancelledByOperatorId: null,
  cancellationReason: null,
  stateBeforeCancel: null,
  flaggedAt: null,
  changeConfirmationStatus: 'none',
  changeExecRelevant: false,
  changePendingSince: null,
  changeConfirmedAt: null,
  changeConfirmedMethod: null,
  changeConfirmedByOperatorId: null,
  isBackfill: false,
  backfillDriverName: null,
  backfillDriverPhone: null,
  backfillCar: null,
  backfillDriverPayPence: null,
  subcontractorPricePence: null,
  completionByOperator: false,
  execNotificationStatus: 'none',
  createdAt: new Date('2026-05-30T10:00:00.000Z'),
  updatedAt: new Date('2026-06-01T10:15:00.000Z'),
};

const driver: Driver = {
  id: 'driver-id-1',
  name: 'Tom',
  vehicleClass: 'executive',
  car: 'Mercedes S-Class',
  carColour: 'Black',
  numberPlate: null,
  pcoNumber: '112233',
  carPcoNumber: null,
  whatsappNumber: '+447911000001',
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('rowFromBooking', () => {
  // Car Type (K) is what the PA asked for at booking time — not the car the
  // assigned driver happens to drive.
  it('writes the requested car type into Car Type (K), even when a driver is assigned', () => {
    const row = rowFromBooking({ booking: { ...baseBooking, requestedCarType: 'MPV' }, driver });
    expect(SHEET_HEADERS[10]).toBe('Car Type');
    expect(row[10]).toBe('MPV');
  });

  it('writes the requested car type for a backfill job instead of the subcontractor car', () => {
    const row = rowFromBooking({
      booking: {
        ...baseBooking,
        requestedCarType: 'Luxury',
        isBackfill: true,
        backfillCar: 'Mercedes V-Class',
      },
      driver: null,
    });
    expect(row[10]).toBe('Luxury');
  });

  it('falls back to the assigned driver class when nothing was requested (legacy rows)', () => {
    const row = rowFromBooking({ booking: baseBooking, driver });
    expect(row[10]).toBe('Executive');
    const unassigned = rowFromBooking({ booking: baseBooking, driver: null });
    expect(unassigned[10]).toBe('');
  });

  it('produces a 21-column row (A–U): the JJ input columns, then Waiting (£) and Total (£)', () => {
    const row = rowFromBooking({ booking: baseBooking, driver });
    expect(row.length).toBe(SHEET_HEADERS.length);
    expect(row.length).toBe(21);
    expect(SHEET_HEADERS[18]).toBe('Mileage (miles)');
    expect(SHEET_HEADERS[19]).toBe('Waiting (£)');
    expect(SHEET_HEADERS[20]).toBe('Total (£)');
    expect(SHEET_LAST_COLUMN).toBe('U');
    expect(SHEET_HEADERS).not.toContain('PA Name');
    expect(SHEET_HEADERS).not.toContain('PA Contact');
  });

  it('formats Waiting (£) and Total (£) as currency like the other money columns', () => {
    expect(MONEY_COLUMN_INDICES).toContain(19);
    expect(MONEY_COLUMN_INDICES).toContain(20);
  });

  // Waiting (£) and Total (£) carry the same figures the console's detail panel
  // shows: waiting = the operator's override, else £1/min × waiting minutes;
  // total = agreed fare + car park + waiting.
  it('writes the computed £1/min waiting charge into Waiting (£) (T)', () => {
    const row = rowFromBooking({ booking: baseBooking, driver }); // 12 min, no override
    expect(row[19]).toBe('12.00');
  });

  it('writes the operator override into Waiting (£) when one is set', () => {
    const row = rowFromBooking({
      booking: { ...baseBooking, waitingTimeMinutes: 12, waitingChargePence: 500 },
      driver,
    });
    expect(row[19]).toBe('5.00');
  });

  it('leaves Waiting (£) blank until a waiting time is recorded', () => {
    const row = rowFromBooking({
      booking: { ...baseBooking, waitingTimeMinutes: null, waitingChargePence: null },
      driver,
    });
    expect(row[19]).toBe('');
  });

  it('writes Total (£) = contract price + car park + waiting charge', () => {
    const row = rowFromBooking({ booking: baseBooking, driver }); // 300 + 7.50 + 12
    expect(row[20]).toBe('319.50');
  });

  it('writes Total (£) as just the fare before any completion data lands', () => {
    const row = rowFromBooking({
      booking: {
        ...baseBooking,
        carParkPence: null,
        waitingTimeMinutes: null,
        waitingChargePence: null,
      },
      driver,
    });
    expect(row[20]).toBe('300.00');
  });

  it('leaves Total (£) blank when the booking has no agreed fare yet, even with extras', () => {
    const row = rowFromBooking({ booking: { ...baseBooking, contractPricePence: null }, driver });
    expect(row[20]).toBe('');
  });

  // Booked By (E) is the PA who booked on the exec's behalf — name plus contact —
  // exactly as the client fills it in their own workbook.
  it('writes the PA name and both contacts into Booked By (E)', () => {
    const row = rowFromBooking({
      booking: {
        ...baseBooking,
        bookedByName: 'Sandra Miles',
        bookedByPhone: '+447911998877',
        bookedByEmail: 'sandra@legogroup.com',
      },
      driver,
    });
    expect(SHEET_HEADERS[4]).toBe('Booked By');
    expect(row[4]).toBe('Sandra Miles (+447911998877 / sandra@legogroup.com)');
  });

  it('writes a single contact without the separator', () => {
    const emailOnly = rowFromBooking({
      booking: {
        ...baseBooking,
        bookedByName: 'Sandra Miles',
        bookedByEmail: 'sandra@legogroup.com',
      },
      driver,
    });
    expect(emailOnly[4]).toBe('Sandra Miles (sandra@legogroup.com)');
    const phoneOnly = rowFromBooking({
      booking: { ...baseBooking, bookedByName: 'Sandra Miles', bookedByPhone: '+447911998877' },
      driver,
    });
    expect(phoneOnly[4]).toBe('Sandra Miles (+447911998877)');
  });

  it('writes just the name when no contact was captured, and the contact alone when there is no name', () => {
    const nameOnly = rowFromBooking({
      booking: { ...baseBooking, bookedByName: 'Sandra Miles' },
      driver,
    });
    expect(nameOnly[4]).toBe('Sandra Miles');
    const contactOnly = rowFromBooking({
      booking: { ...baseBooking, bookedByPhone: '+447911998877' },
      driver,
    });
    expect(contactOnly[4]).toBe('+447911998877');
  });

  it('leaves Booked By blank when no PA was recorded — never the operator', () => {
    const row = rowFromBooking({ booking: baseBooking, driver });
    expect(row[4]).toBe('');
  });

  it('leaves driver columns blank when no driver provided', () => {
    const row = rowFromBooking({ booking: baseBooking });
    expect(row[12]).toBe(''); // M Driver Name
    expect(row[13]).toBe(''); // N Driver Type
  });

  it('leaves Contract Price (L) blank when the booking has no price yet', () => {
    const row = rowFromBooking({
      booking: { ...baseBooking, contractPricePence: null },
      driver,
    });
    expect(row[11]).toBe(''); // L Contract Price — blank, not "0.00"
  });
});

describe('FakeSpreadsheetMirror', () => {
  it('stores last row per booking id', async () => {
    const m = new FakeSpreadsheetMirror();
    await m.upsertRow({ booking: baseBooking, driver });
    expect(m.rows.size).toBe(1);
    const updated: Booking = {
      ...baseBooking,
      contractPricePence: 50000,
    };
    await m.upsertRow({ booking: updated, driver });
    expect(m.rows.size).toBe(1);
    expect(m.rows.get(baseBooking.id)?.[11]).toBe('500.00');
  });

  it('reset clears rows', async () => {
    const m = new FakeSpreadsheetMirror();
    await m.upsertRow({ booking: baseBooking, driver });
    m.reset();
    expect(m.rows.size).toBe(0);
  });
});
