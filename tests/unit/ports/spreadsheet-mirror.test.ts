import { FakeSpreadsheetMirror } from '@/server/adapters/spreadsheet-mirror-fake';
import type { Booking, Driver, Operator } from '@/server/db/schema';
import { SHEET_HEADERS, rowFromBooking } from '@/server/ports/spreadsheet-mirror';
import { describe, expect, it } from 'vitest';

const baseBooking: Booking = {
  id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  state: 'completed',
  pickupAt: new Date('2026-06-01T08:30:00.000Z'),
  expectedDurationMinutes: 90,
  pickupAddress: '11 Belsize Park Gardens',
  dropoffAddress: 'LHR T5',
  passengerFirstName: 'Eric',
  passengerLastName: 'French',
  execMobile: '+447911999999',
  clientName: 'LEGO Group',
  accountCode: 'LEGO',
  caseCode: 'LEGO-CASE-9',
  contractPricePence: 30000,
  notes: null,
  createdByOperatorId: 'op-1',
  assignedOperatorId: 'op-1',
  assignedDriverId: 'driver-id-1',
  carForThisJob: 'Mercedes S-Class',
  assignedAt: new Date('2026-06-01T07:00:00.000Z'),
  carParkPence: 750,
  waitingTimeMinutes: 12,
  dropoffAt: new Date('2026-06-01T10:05:00.000Z'),
  completionSubmittedAt: new Date('2026-06-01T10:10:00.000Z'),
  approvedAt: new Date('2026-06-01T10:15:00.000Z'),
  approvedByOperatorId: 'op-1',
  cancelledAt: null,
  cancelledByOperatorId: null,
  cancellationReason: null,
  flaggedAt: null,
  createdAt: new Date('2026-05-30T10:00:00.000Z'),
  updatedAt: new Date('2026-06-01T10:15:00.000Z'),
};

const driver: Driver = {
  id: 'driver-id-1',
  name: 'Tom',
  tier: 'premium',
  defaultCarType: 'Mercedes S-Class',
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
  it('produces a 30-column row matching the JJ DATA layout', () => {
    const row = rowFromBooking({ booking: baseBooking, driver });
    expect(row.length).toBe(SHEET_HEADERS.length);
    expect(row.length).toBe(30);
  });

  it('formats pickup date and time of day', () => {
    const row = rowFromBooking({ booking: baseBooking, driver });
    expect(row[1]).toBe('2026-06-01'); // Date
    expect(row[2]).toBe('08:30'); // Pick Up Time
  });

  it('renders price in pounds with 2 decimals', () => {
    const row = rowFromBooking({ booking: baseBooking, driver });
    expect(row[11]).toBe('300.00'); // Contract Price (£)
    expect(row[15]).toBe('7.50'); // Car Park (£)
  });

  it('renders waiting minutes as hh:mm', () => {
    const row = rowFromBooking({
      booking: { ...baseBooking, waitingTimeMinutes: 65 },
      driver,
    });
    expect(row[16]).toBe('01:05');
  });

  it('emits empty string when fields are null', () => {
    const row = rowFromBooking({
      booking: {
        ...baseBooking,
        carParkPence: null,
        waitingTimeMinutes: null,
        dropoffAt: null,
      },
      driver,
    });
    expect(row[15]).toBe('');
    expect(row[16]).toBe('');
    expect(row[17]).toBe('');
  });

  it('renders Yes/No for invoice flag based on completed state', () => {
    const completed = rowFromBooking({ booking: baseBooking, driver });
    expect(completed[18]).toBe('Yes');
    const assigned = rowFromBooking({
      booking: { ...baseBooking, state: 'assigned' },
      driver,
    });
    expect(assigned[18]).toBe('No');
  });

  it('renders the vehicle the driver brought (carForThisJob)', () => {
    const row = rowFromBooking({ booking: baseBooking, driver });
    expect(row[10]).toBe('Mercedes S-Class');
  });

  it('leaves the vehicle column blank when carForThisJob is null', () => {
    const row = rowFromBooking({ booking: { ...baseBooking, carForThisJob: null }, driver });
    expect(row[10]).toBe('');
  });

  it('renders the operator name in the Booked By column', () => {
    const row = rowFromBooking({ booking: baseBooking, driver, operator });
    expect(row[4]).toBe('Alice');
  });

  it('leaves Booked By blank when no operator provided', () => {
    const row = rowFromBooking({ booking: baseBooking, driver });
    expect(row[4]).toBe('');
  });

  it('leaves driver columns blank when no driver provided', () => {
    const row = rowFromBooking({ booking: baseBooking });
    expect(row[12]).toBe(''); // Driver Name
    expect(row[13]).toBe(''); // Driver Type
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
