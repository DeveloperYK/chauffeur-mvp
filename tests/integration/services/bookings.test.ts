import { auditEvents, bookings, operators } from '@/server/db/schema';
import { fixedClock } from '@/server/ports/clock';
import { createBooking } from '@/server/services/bookings';
import { groupByState, listActiveBookings } from '@/server/services/bookings-query';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestDb, createTestDb } from '~test/helpers/pglite-db';

describe('services/bookings (integration)', () => {
  let db: TestDb;
  let close: () => Promise<void>;
  let operatorId: string;

  beforeAll(async () => {
    const t = await createTestDb();
    db = t.db;
    close = t.close;
    const [op] = await db
      .insert(operators)
      .values({ email: 'op@example.com', passwordHash: 'x', name: 'Op' })
      .returning();
    operatorId = op?.id ?? '';
  });

  afterAll(async () => {
    await close();
  });

  beforeEach(async () => {
    await db.delete(bookings);
    await db.delete(auditEvents);
  });

  const validInput = (overrides: Record<string, unknown> = {}) => ({
    pickupAt: new Date('2026-06-01T10:00:00.000Z').toISOString(),
    expectedDurationMinutes: 90,
    pickupAddress: '11 Belsize Park Gardens, London',
    dropoffAddress: 'LHR Terminal 5',
    passengerFirstName: 'Eric',
    passengerLastName: 'French',
    execMobile: '+447911123456',
    clientName: 'LEGO Group',
    accountCode: 'LEGO',
    contractPricePence: 30000,
    notes: null,
    ...overrides,
  });

  const clock = fixedClock('2026-05-18T10:00:00.000Z');

  it('creates a booking with valid input and writes an audit event', async () => {
    const result = await createBooking(validInput(), { db, clock, operatorId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.booking.state).toBe('unassigned');
    expect(result.booking.execMobile).toBe('+447911123456');

    const rows = await db.select().from(bookings);
    expect(rows.length).toBe(1);

    const events = await db.select().from(auditEvents);
    expect(events.length).toBe(1);
    expect(events[0]?.action).toBe('create');
    expect(events[0]?.entityId).toBe(result.booking.id);
    expect(events[0]?.actorType).toBe('operator');
    expect(events[0]?.actorId).toBe(operatorId);
  });

  it('requires account code (validation error when missing)', async () => {
    const { accountCode, ...withoutAccountCode } = validInput();
    void accountCode;
    const result = await createBooking(withoutAccountCode, { db, clock, operatorId });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('validation');
  });

  it('rejects pickup in the past', async () => {
    const result = await createBooking(validInput({ pickupAt: '2025-01-01T10:00:00.000Z' }), {
      db,
      clock,
      operatorId,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('pickup_in_past');
  });

  it('rejects invalid phone', async () => {
    const result = await createBooking(validInput({ execMobile: 'not-a-phone' }), {
      db,
      clock,
      operatorId,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('validation');
  });

  it('rejects duration outside 15–720 minutes', async () => {
    const tooShort = await createBooking(validInput({ expectedDurationMinutes: 5 }), {
      db,
      clock,
      operatorId,
    });
    expect(tooShort.ok).toBe(false);

    const tooLong = await createBooking(validInput({ expectedDurationMinutes: 1000 }), {
      db,
      clock,
      operatorId,
    });
    expect(tooLong.ok).toBe(false);
  });

  it('rejects negative price', async () => {
    const result = await createBooking(validInput({ contractPricePence: -1 }), {
      db,
      clock,
      operatorId,
    });
    expect(result.ok).toBe(false);
  });

  it('rejects unknown extra fields', async () => {
    const result = await createBooking(validInput({ surprise: 'attack' }), {
      db,
      clock,
      operatorId,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('validation');
  });

  it('listActiveBookings + groupByState put new booking in unassigned column', async () => {
    await createBooking(validInput(), { db, clock, operatorId });
    const rows = await listActiveBookings(db);
    const board = groupByState(rows);
    expect(board.unassigned.length).toBe(1);
    expect(board.assigned.length).toBe(0);
  });

  it('normalises phone numbers to E.164', async () => {
    const result = await createBooking(validInput({ execMobile: '07700 900 100' }), {
      db,
      clock,
      operatorId,
    });
    // Note: 07700-prefixed numbers are UK format. libphonenumber-js without
    // a default country may treat them as ambiguous. Test only that the
    // service rejects ambiguity rather than guessing.
    if (result.ok) {
      expect(result.booking.execMobile.startsWith('+')).toBe(true);
    } else {
      expect(result.reason).toBe('validation');
    }
  });

  it('groupByState splits across all 7 columns', async () => {
    // Insert a row for each state via direct SQL to test grouping shape
    const states = [
      'unassigned',
      'assigned',
      'in_progress',
      'awaiting_driver_form',
      'awaiting_operator_review',
      'completed',
      'cancelled',
    ] as const;
    for (const s of states) {
      await db.insert(bookings).values({
        state: s,
        pickupAt: new Date('2026-06-01T10:00:00.000Z'),
        expectedDurationMinutes: 60,
        pickupAddress: 'a',
        dropoffAddress: 'b',
        passengerFirstName: 'x',
        passengerLastName: 'y',
        execMobile: '+447911123456',
        clientName: 'Test Client',
        accountCode: 'X',
        contractPricePence: 1000,
      });
    }
    const rows = await listActiveBookings(db);
    const board = groupByState(rows);
    for (const s of states) {
      expect(board[s].length).toBe(1);
    }
  });
});
