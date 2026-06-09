import { type Booking, bookings, operators } from '@/server/db/schema';
import { listBillableBookings } from '@/server/services/bookings-query';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestDb, createTestDb } from '~test/helpers/pglite-db';

describe('services/bookings-query listBillableBookings (integration)', () => {
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
  });

  function seed(overrides: Partial<Booking> & { pickupAt: Date }) {
    return db.insert(bookings).values({
      state: 'completed',
      expectedDurationMinutes: 90,
      pickupAddress: 'A',
      dropoffAddress: 'B',
      passengerFirstName: 'Eric',
      passengerLastName: 'French',
      execMobile: '+447911123456',
      clientName: 'LEGO Group',
      accountCode: 'LEGO Group',
      caseCode: 'LEGO-1',
      contractPricePence: 30000,
      createdByOperatorId: operatorId,
      assignedOperatorId: operatorId,
      ...overrides,
    });
  }

  it('returns only completed bookings whose pickup is in the London month', async () => {
    await seed({ pickupAt: new Date('2026-06-10T09:00:00.000Z') }); // in month, completed ✓
    await seed({ pickupAt: new Date('2026-06-20T09:00:00.000Z'), state: 'cancelled' }); // excluded
    await seed({ pickupAt: new Date('2026-06-15T09:00:00.000Z'), state: 'assigned' }); // excluded (in-flight)
    await seed({ pickupAt: new Date('2026-05-31T09:00:00.000Z') }); // previous month, excluded
    await seed({ pickupAt: new Date('2026-07-01T09:00:00.000Z') }); // next month, excluded

    const rows = await listBillableBookings(db, '2026-06');
    expect(rows.length).toBe(1);
    expect(rows[0]?.state).toBe('completed');
    expect(rows[0]?.pickupAt.toISOString()).toBe('2026-06-10T09:00:00.000Z');
  });

  it('uses London month boundaries (BST): a 23:30 UTC pickup on May 31 is June 1 in London', async () => {
    // 2026-05-31 23:30 UTC = 2026-06-01 00:30 BST → belongs to June.
    await seed({ pickupAt: new Date('2026-05-31T23:30:00.000Z') });
    const june = await listBillableBookings(db, '2026-06');
    expect(june.length).toBe(1);
    const may = await listBillableBookings(db, '2026-05');
    expect(may.length).toBe(0);
  });

  it('returns an empty array for an invalid month string', async () => {
    await seed({ pickupAt: new Date('2026-06-10T09:00:00.000Z') });
    expect(await listBillableBookings(db, 'nonsense')).toEqual([]);
  });

  it('includes completed backfill bookings (no internal driver) in the billable set', async () => {
    await seed({
      pickupAt: new Date('2026-06-12T09:00:00.000Z'),
      assignedDriverId: null,
      isBackfill: true,
      backfillDriverName: 'Dave Smith',
      backfillDriverPhone: '+447911123456',
      carParkPence: 500,
      waitingTimeMinutes: 20,
    });
    const rows = await listBillableBookings(db, '2026-06');
    expect(rows.length).toBe(1);
    expect(rows[0]?.isBackfill).toBe(true);
    expect(rows[0]?.assignedDriverId).toBeNull();
  });
});
