import { bookings, drivers, operators } from '@/server/db/schema';
import { fastForwardBooking, seedSampleData } from '@/server/services/simulator';
import { eq } from 'drizzle-orm';
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

  it('seeds whole-minute pickup times (the edit form only holds minutes)', async () => {
    await seedSampleData(db, operatorId);
    const rows = await db.select().from(bookings);
    expect(rows.length).toBeGreaterThan(0);
    for (const b of rows) {
      expect(b.pickupAt.getSeconds()).toBe(0);
      expect(b.pickupAt.getMilliseconds()).toBe(0);
    }
  });

  it('is idempotent for drivers (re-seeding does not duplicate them)', async () => {
    await seedSampleData(db, operatorId);
    const second = await seedSampleData(db, operatorId);
    expect(second.driversCreated).toBe(0);
    const driverRows = await db.select().from(drivers);
    expect(driverRows.length).toBe(5);
  });
});

describe('services/simulator fastForwardBooking (integration)', () => {
  let db: TestDb;
  let close: () => Promise<void>;
  let operatorId: string;

  beforeAll(async () => {
    const t = await createTestDb();
    db = t.db;
    close = t.close;
    const [op] = await db
      .insert(operators)
      .values({ email: 'ff@example.com', passwordHash: 'x', name: 'Op' })
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

  async function firstBookingId(): Promise<string> {
    await seedSampleData(db, operatorId);
    const [b] = await db.select().from(bookings).limit(1);
    return b?.id ?? '';
  }

  async function pickupOf(id: string): Promise<Date> {
    const [b] = await db.select().from(bookings).where(eq(bookings.id, id)).limit(1);
    return b?.pickupAt ?? new Date(0);
  }

  // Real bookings are entered through a minute-precision picker, so the
  // simulator must not smuggle seconds into pickup_at. The completion form
  // works in whole minutes; a pickup at hh:mm:40 made the derived waiting
  // time round down and flaked the lifecycle E2E.
  it('about_to_start sets a whole-minute pickup ~30 minutes ahead', async () => {
    const id = await firstBookingId();
    const before = Date.now();
    await fastForwardBooking(db, id, 'about_to_start');
    const pickup = await pickupOf(id);
    expect(pickup.getSeconds()).toBe(0);
    expect(pickup.getMilliseconds()).toBe(0);
    const aheadMs = pickup.getTime() - before;
    expect(aheadMs).toBeGreaterThan(29 * 60_000);
    expect(aheadMs).toBeLessThanOrEqual(30 * 60_000 + 1000);
  });

  it('trip_finished sets a whole-minute pickup ~2 hours ago', async () => {
    const id = await firstBookingId();
    const before = Date.now();
    await fastForwardBooking(db, id, 'trip_finished');
    const pickup = await pickupOf(id);
    expect(pickup.getSeconds()).toBe(0);
    const behindMs = before - pickup.getTime();
    expect(behindMs).toBeGreaterThanOrEqual(2 * 3_600_000 - 1000);
    expect(behindMs).toBeLessThan(2 * 3_600_000 + 60_000);
  });

  it('aged_unaccepted backdates created_at by 25 hours and clears the flag', async () => {
    const id = await firstBookingId();
    await fastForwardBooking(db, id, 'aged_unaccepted');
    const [b] = await db.select().from(bookings).where(eq(bookings.id, id)).limit(1);
    expect(b?.flaggedAt).toBeNull();
    expect(Date.now() - (b?.createdAt.getTime() ?? 0)).toBeGreaterThanOrEqual(
      25 * 3_600_000 - 1000,
    );
  });
});
