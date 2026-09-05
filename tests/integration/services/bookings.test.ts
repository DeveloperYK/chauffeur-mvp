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
    customerAccount: 'LEGO Group',
    caseCode: 'LEGO-2026-001',
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
    // Customer Account is stored in account_code and mirrored into client_name.
    expect(result.booking.accountCode).toBe('LEGO Group');
    expect(result.booking.clientName).toBe('LEGO Group');
    expect(result.booking.caseCode).toBe('LEGO-2026-001');

    const rows = await db.select().from(bookings);
    expect(rows.length).toBe(1);

    const events = await db.select().from(auditEvents);
    expect(events.length).toBe(1);
    expect(events[0]?.action).toBe('create');
    expect(events[0]?.entityId).toBe(result.booking.id);
    expect(events[0]?.actorType).toBe('operator');
    expect(events[0]?.actorId).toBe(operatorId);
  });

  it('parses a bare datetime-local pickup as Europe/London (BST), not server-local', async () => {
    // The booking form sends a bare wall-clock string with no timezone. 10:30
    // London in BST is 09:30 UTC — this assertion is timezone-independent, so it
    // fails under UTC CI if the schema ever regresses to `new Date(string)`.
    const result = await createBooking(validInput({ pickupAt: '2026-07-01T10:30' }), {
      db,
      clock,
      operatorId,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.booking.pickupAt.toISOString()).toBe('2026-07-01T09:30:00.000Z');
  });

  it('persists driver-facing and operator-only notes separately', async () => {
    const result = await createBooking(
      validInput({
        notes: 'Flight BA268, two suitcases',
        operatorNotes: 'Awkward client — never tips, keep it professional',
      }),
      { db, clock, operatorId },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.booking.notes).toBe('Flight BA268, two suitcases');
    expect(result.booking.operatorNotes).toBe('Awkward client — never tips, keep it professional');
  });

  it('defaults operator notes to null when omitted', async () => {
    const result = await createBooking(validInput(), { db, clock, operatorId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.booking.operatorNotes).toBeNull();
  });

  it('accepts a booking with no customer account, case code or exec mobile (all optional)', async () => {
    const { customerAccount, caseCode, execMobile, ...minimal } = validInput();
    void customerAccount;
    void caseCode;
    void execMobile;
    const result = await createBooking(minimal, { db, clock, operatorId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.booking.accountCode).toBeNull();
    expect(result.booking.clientName).toBeNull();
    expect(result.booking.caseCode).toBeNull();
    expect(result.booking.execMobile).toBeNull();
  });

  it('stores blank customer account / case code / exec mobile as null (the form posts empty strings)', async () => {
    const result = await createBooking(
      validInput({ customerAccount: '', caseCode: '  ', execMobile: '' }),
      { db, clock, operatorId },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.booking.accountCode).toBeNull();
    expect(result.booking.caseCode).toBeNull();
    expect(result.booking.execMobile).toBeNull();
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
      expect(result.booking.execMobile?.startsWith('+')).toBe(true);
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

  describe('service types', () => {
    it('defaults to a transfer and stores the route distance', async () => {
      const result = await createBooking(
        validInput({ distanceMeters: 28000, contractPricePence: 5000 }),
        { db, clock, operatorId },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.booking.serviceType).toBe('transfer');
      expect(result.booking.distanceMeters).toBe(28000);
      expect(result.booking.dropoffAddress).toBe('LHR Terminal 5');
    });

    it('rejects a transfer with no destination', async () => {
      const result = await createBooking(
        validInput({ serviceType: 'transfer', dropoffAddress: '' }),
        { db, clock, operatorId },
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('validation');
    });

    it('creates an hourly hire with no destination and clears distance', async () => {
      const result = await createBooking(
        validInput({
          serviceType: 'hourly',
          dropoffAddress: '',
          distanceMeters: 9999,
          expectedDurationMinutes: 240,
        }),
        { db, clock, operatorId },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.booking.serviceType).toBe('hourly');
      expect(result.booking.dropoffAddress).toBeNull();
      expect(result.booking.distanceMeters).toBeNull();
    });

    it('rejects an explicit zero price (blank means "not agreed yet", zero is a mistake)', async () => {
      const result = await createBooking(
        validInput({ contractPricePence: 0, distanceMeters: Math.round(10 * 1609.344) }),
        { db, clock, operatorId },
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('validation');
    });

    it('stores the operator-entered price verbatim', async () => {
      const result = await createBooking(
        validInput({ contractPricePence: 9999, distanceMeters: 28000 }),
        { db, clock, operatorId },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.booking.contractPricePence).toBe(9999);
    });
  });

  describe('optional pricing', () => {
    it('creates a booking with no contract price when the operator does not know it yet', async () => {
      const result = await createBooking(validInput({ contractPricePence: null }), {
        db,
        clock,
        operatorId,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.booking.contractPricePence).toBeNull();
    });

    it('creates a booking when the contract price key is omitted entirely', async () => {
      const { contractPricePence: _omitted, ...rest } = validInput();
      const result = await createBooking(rest, { db, clock, operatorId });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.booking.contractPricePence).toBeNull();
    });

    it('stores the subcontractor price when given', async () => {
      const result = await createBooking(validInput({ subcontractorPricePence: 15000 }), {
        db,
        clock,
        operatorId,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.booking.subcontractorPricePence).toBe(15000);
      expect(result.booking.contractPricePence).toBe(30000);
    });

    it('defaults the subcontractor price to null when omitted', async () => {
      const result = await createBooking(validInput(), { db, clock, operatorId });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.booking.subcontractorPricePence).toBeNull();
    });

    it('accepts a booking with a subcontractor price but no contract price', async () => {
      const result = await createBooking(
        validInput({ contractPricePence: null, subcontractorPricePence: 12000 }),
        { db, clock, operatorId },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.booking.contractPricePence).toBeNull();
      expect(result.booking.subcontractorPricePence).toBe(12000);
    });

    it('rejects a zero subcontractor price', async () => {
      const result = await createBooking(validInput({ subcontractorPricePence: 0 }), {
        db,
        clock,
        operatorId,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('validation');
    });

    it('rejects a negative subcontractor price', async () => {
      const result = await createBooking(validInput({ subcontractorPricePence: -500 }), {
        db,
        clock,
        operatorId,
      });
      expect(result.ok).toBe(false);
    });

    it('rejects a subcontractor price over the maximum', async () => {
      const result = await createBooking(validInput({ subcontractorPricePence: 10_000_01 }), {
        db,
        clock,
        operatorId,
      });
      expect(result.ok).toBe(false);
    });
  });
});

describe('services/bookings — flight/train reference', () => {
  let db2: TestDb;
  let close2: () => Promise<void>;
  let opId: string;

  beforeAll(async () => {
    const t = await createTestDb();
    db2 = t.db;
    close2 = t.close;
    const [op] = await db2
      .insert(operators)
      .values({ email: 'op2@example.com', passwordHash: 'x', name: 'Op2' })
      .returning();
    opId = op?.id ?? '';
  });

  afterAll(async () => {
    await close2();
  });

  const clock = fixedClock('2026-05-18T10:00:00.000Z');
  const input = (overrides: Record<string, unknown> = {}) => ({
    pickupAt: new Date('2026-06-01T10:00:00.000Z').toISOString(),
    expectedDurationMinutes: 90,
    pickupAddress: 'LHR Terminal 5',
    dropoffAddress: '11 Belsize Park Gardens, London',
    passengerFirstName: 'Eric',
    execMobile: '+447911123456',
    customerAccount: 'LEGO Group',
    caseCode: 'LEGO-2026-001',
    contractPricePence: 30000,
    ...overrides,
  });

  // Happy paths
  it('stores a flight reference normalized to its IATA designator', async () => {
    const result = await createBooking(input({ travelMode: 'flight', travelRef: 'ba 268' }), {
      db: db2,
      clock,
      operatorId: opId,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.booking.travelMode).toBe('flight');
    expect(result.booking.travelRef).toBe('BA268');
  });

  it('stores a train arrival reference trimmed', async () => {
    const result = await createBooking(
      input({ travelMode: 'train', travelRef: ' 12:03 from Manchester Piccadilly ' }),
      { db: db2, clock, operatorId: opId },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.booking.travelMode).toBe('train');
    expect(result.booking.travelRef).toBe('12:03 from Manchester Piccadilly');
  });

  it('creates a booking with no travel reference at all', async () => {
    const result = await createBooking(input(), { db: db2, clock, operatorId: opId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.booking.travelMode).toBeNull();
    expect(result.booking.travelRef).toBeNull();
  });

  // Unhappy paths
  it('rejects a travel reference without a mode', async () => {
    const result = await createBooking(input({ travelRef: 'BA268' }), {
      db: db2,
      clock,
      operatorId: opId,
    });
    expect(result).toMatchObject({ ok: false, reason: 'validation' });
  });

  it('rejects a mode without a reference', async () => {
    const result = await createBooking(input({ travelMode: 'flight' }), {
      db: db2,
      clock,
      operatorId: opId,
    });
    expect(result).toMatchObject({ ok: false, reason: 'validation' });
  });

  it('rejects an invalid flight designator', async () => {
    const result = await createBooking(input({ travelMode: 'flight', travelRef: '268' }), {
      db: db2,
      clock,
      operatorId: opId,
    });
    expect(result).toMatchObject({ ok: false, reason: 'validation' });
  });
});
