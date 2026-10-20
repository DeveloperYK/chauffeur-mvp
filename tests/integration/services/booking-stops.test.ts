import { bookingStops, bookings, operators } from '@/server/db/schema';
import { listStopsForBookings, replaceStops } from '@/server/services/booking-stops';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SeedData } from '~test/fixtures/seed-data';
import { type TestDb, createTestDb } from '~test/helpers/pglite-db';

describe('services/booking-stops (integration)', () => {
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

  async function seed(): Promise<string> {
    const [b] = await db
      .insert(bookings)
      .values(SeedData.bookings.unassigned(operatorId))
      .returning({ id: bookings.id });
    if (!b) throw new Error('seed failed');
    return b.id;
  }

  it('replaces the stop list in order and reads it back grouped by booking', async () => {
    const a = await seed();
    const b = await seed();
    await replaceStops(db, a, [
      { address: 'One, London E1 6AN', plannedWaitMinutes: 40 },
      { address: 'Two, London E2 7DG', plannedWaitMinutes: 0 },
    ]);
    await replaceStops(db, b, [{ address: 'Three, London E3 2DA', plannedWaitMinutes: 15 }]);

    const map = await listStopsForBookings(db, [a, b]);
    expect(map.get(a)?.map((s) => [s.seq, s.address, s.plannedWaitMinutes])).toEqual([
      [1, 'One, London E1 6AN', 40],
      [2, 'Two, London E2 7DG', 0],
    ]);
    expect(map.get(b)?.map((s) => s.address)).toEqual(['Three, London E3 2DA']);
  });

  it('a second replace drops the old rows (no duplicates, re-numbered from 1)', async () => {
    const a = await seed();
    await replaceStops(db, a, [
      { address: 'One, London E1 6AN', plannedWaitMinutes: 0 },
      { address: 'Two, London E2 7DG', plannedWaitMinutes: 0 },
    ]);
    await replaceStops(db, a, [{ address: 'Two, London E2 7DG', plannedWaitMinutes: 10 }]);
    const rows = await db.select().from(bookingStops).where(eq(bookingStops.bookingId, a));
    expect(rows.map((r) => [r.seq, r.address, r.plannedWaitMinutes])).toEqual([
      [1, 'Two, London E2 7DG', 10],
    ]);
  });

  it('replacing with an empty list clears the stops', async () => {
    const a = await seed();
    await replaceStops(db, a, [{ address: 'One, London E1 6AN', plannedWaitMinutes: 0 }]);
    await replaceStops(db, a, []);
    expect((await listStopsForBookings(db, [a])).get(a) ?? []).toEqual([]);
  });

  it('returns an empty map for no ids and omits bookings with no stops', async () => {
    const a = await seed();
    expect((await listStopsForBookings(db, [])).size).toBe(0);
    expect((await listStopsForBookings(db, [a])).has(a)).toBe(false);
  });

  it('stops are deleted with their booking', async () => {
    const a = await seed();
    await replaceStops(db, a, [{ address: 'One, London E1 6AN', plannedWaitMinutes: 0 }]);
    await db.delete(bookings).where(eq(bookings.id, a));
    expect((await db.select().from(bookingStops)).length).toBe(0);
  });
});
