import { bookings, drivers, operators } from '@/server/db/schema';
import { seedSampleData } from '@/server/services/simulator';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestDb, createTestDb } from '~test/helpers/pglite-db';

describe('services/simulator seedSampleData (integration)', () => {
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
    await db.delete(drivers);
  });

  // Regression: the sample bookings must use phone numbers that pass
  // createBooking's libphonenumber validation. Two of them previously used an
  // invalid GB range and were silently dropped, so the seed produced 1 booking
  // instead of 3.
  it('creates all sample drivers and bookings', async () => {
    const report = await seedSampleData(db, operatorId);
    expect(report.driversCreated).toBe(5);
    expect(report.bookingsCreated).toBe(3);

    const bookingRows = await db.select().from(bookings);
    expect(bookingRows.length).toBe(3);
    const driverRows = await db.select().from(drivers);
    expect(driverRows.length).toBe(5);
  });

  it('is idempotent for drivers (re-seeding does not duplicate them)', async () => {
    await seedSampleData(db, operatorId);
    const second = await seedSampleData(db, operatorId);
    expect(second.driversCreated).toBe(0);
    const driverRows = await db.select().from(drivers);
    expect(driverRows.length).toBe(5);
  });
});
