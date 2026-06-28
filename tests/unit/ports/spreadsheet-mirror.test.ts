import { FakeSpreadsheetMirror } from '@/server/adapters/spreadsheet-mirror-fake';
import type { Booking, Driver, Operator } from '@/server/db/schema';
import { SHEET_HEADERS, rowFromBooking } from '@/server/ports/spreadsheet-mirror';
import { describe, expect, it } from 'vitest';

const baseBooking: Booking = {
  id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  seq: 42,
  state: 'completed',
  serviceType: 'transfer',
  pickupAt: new Date('2026-06-01T08:30:00.000Z'),
  expectedDurationMinutes: 90,
  distanceMeters: 28000,
  pickupAddress: '11 Belsize Park Gardens',
  dropoffAddress: 'LHR T5',
  passengerFirstName: 'Eric',
  passengerLastName: 'French',
  execMobile: '+447911999999',
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
  dropoffAt: new Date('2026-06-01T10:05:00.000Z'),
  completionSubmittedAt: new Date('2026-06-01T10:10:00.000Z'),
  approvedAt: new Date('2026-06-01T10:15:00.000Z'),
  approvedByOperatorId: 'op-1',
  cancelledAt: null,
  cancelledByOperatorId: null,
  cancellationReason: null,
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
  whatsappNumber: '+447911000001',
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const operator: Operator = {
  id: 'op-1',
  email: 'op@example.com',
  passwordHash: 'x',
  name: 'Alice',
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('rowFromBooking', () => {
  it('produces an 18-column row (A–R) of JJ input columns', () => {
    const row = rowFromBooking({ booking: baseBooking, driver });
    expect(row.length).toBe(SHEET_HEADERS.length);
    expect(row.length).toBe(18);
  });

  it('formats pickup date and time of day in Europe/London (BST)', () => {
    const row = rowFromBooking({ booking: baseBooking, driver });
    expect(row[1]).toBe('2026-06-01'); // B Date (London)
    expect(row[2]).toBe('09:30'); // C Pick Up Time — 08:30 UTC is 09:30 BST
  });

  it('rolls the date and time into the next London day near midnight (BST)', () => {
    // 2026-06-01 23:30 UTC is 2026-06-02 00:30 BST — a different calendar day.
    const row = rowFromBooking({
      booking: { ...baseBooking, pickupAt: new Date('2026-06-01T23:30:00.000Z') },
      driver,
    });
    expect(row[1]).toBe('2026-06-02'); // B Date (London)
    expect(row[2]).toBe('00:30'); // C Pick Up Time (London)
  });

  it('renders prices in pounds with 2 decimals', () => {
    const row = rowFromBooking({ booking: baseBooking, driver });
    expect(row[11]).toBe('300.00'); // L Contract Price (£)
    expect(row[15]).toBe('7.50'); // P Car Park (£)
  });

  it('renders waiting minutes as hh:mm', () => {
    const row = rowFromBooking({
      booking: { ...baseBooking, waitingTimeMinutes: 65 },
      driver,
    });
    expect(row[16]).toBe('01:05'); // Q Waiting Time
  });

  it('renders the drop-off time of day in Europe/London (R)', () => {
    const row = rowFromBooking({ booking: baseBooking, driver });
    expect(row[17]).toBe('11:05'); // R Drop Off Time — 10:05 UTC is 11:05 BST
  });

  it('emits empty string when optional fields are null', () => {
    const row = rowFromBooking({
      booking: {
        ...baseBooking,
        carParkPence: null,
        waitingTimeMinutes: null,
        dropoffAt: null,
      },
      driver,
    });
    expect(row[14]).toBe(''); // O Driver Cost — no subcontractor pay
    expect(row[15]).toBe(''); // P Car Park
    expect(row[16]).toBe(''); // Q Waiting Time
    expect(row[17]).toBe(''); // R Drop Off Time
  });

  it("renders the assigned driver's car + colour in the Car Type column", () => {
    const row = rowFromBooking({ booking: baseBooking, driver });
    expect(row[10]).toBe('Black Mercedes S-Class'); // K
  });

  it('renders the backfill car, driver name, Subcontractor type and cost for a subcontractor job', () => {
    const row = rowFromBooking({
      booking: {
        ...baseBooking,
        isBackfill: true,
        backfillCar: 'Black Range Rover',
        backfillDriverName: 'Andy',
        backfillDriverPayPence: 15000,
      },
      driver: null,
    });
    expect(row[10]).toBe('Black Range Rover'); // K Car Type
    expect(row[12]).toBe('Andy'); // M Driver Name (recorded on the booking)
    expect(row[13]).toBe('Subcontractor'); // N Driver Type
    expect(row[14]).toBe('150.00'); // O Driver Cost
  });

  it('marks an internally-assigned job as Employee with a blank Driver Cost', () => {
    const row = rowFromBooking({ booking: baseBooking, driver });
    expect(row[12]).toBe('Tom'); // M Driver Name
    expect(row[13]).toBe('Employee'); // N Driver Type
    expect(row[14]).toBe(''); // O Driver Cost — not tracked for employees
  });

  it('leaves the Car Type column blank when no driver is assigned', () => {
    const row = rowFromBooking({ booking: baseBooking, driver: null });
    expect(row[10]).toBe('');
  });

  it('renders the operator name in the Booked By column', () => {
    const row = rowFromBooking({ booking: baseBooking, driver, operator });
    expect(row[4]).toBe('Alice'); // E
  });

  it('leaves Booked By blank when no operator provided', () => {
    const row = rowFromBooking({ booking: baseBooking, driver });
    expect(row[4]).toBe('');
  });

  it('leaves driver columns blank when no driver provided', () => {
    const row = rowFromBooking({ booking: baseBooking });
    expect(row[12]).toBe(''); // M Driver Name
    expect(row[13]).toBe(''); // N Driver Type
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
