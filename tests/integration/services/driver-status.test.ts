import { bookings, drivers, operators } from '@/server/db/schema';
import { driverStatusData } from '@/server/services/bookings-query';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SeedData } from '~test/fixtures/seed-data';
import { type TestDb, createTestDb } from '~test/helpers/pglite-db';

const NOW = new Date('2026-05-20T12:00:00.000Z');
const MIN = 60_000;

describe('services/driverStatusData (integration)', () => {
  let db: TestDb;
  let close: () => Promise<void>;
  let operatorId: string;
  let driverId: string;

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
    const [d] = await db
      .insert(drivers)
      .values({
        name: 'Tom',
        tier: 'premium',
        defaultCarType: 's_class',
        whatsappNumber: '+447911000001',
      })
      .returning();
    driverId = d?.id ?? '';
  });

  async function seedAssigned(overrides: Record<string, unknown>) {
    await db
      .insert(bookings)
      .values(
        SeedData.bookings.unassigned(operatorId, { assignedDriverId: driverId, ...overrides }),
      );
  }

  it('reports on-a-job (with dropoff + until) and the next assignment', async () => {
    await seedAssigned({
      state: 'in_progress',
      pickupAt: new Date(NOW.getTime() - 20 * MIN),
      expectedDurationMinutes: 60,
      dropoffAddress: 'Heathrow T5',
    });
    await seedAssigned({
      state: 'assigned',
      pickupAt: new Date(NOW.getTime() + 90 * MIN),
      expectedDurationMinutes: 60,
      pickupAddress: 'Soho',
      dropoffAddress: 'Gatwick',
    });

    const status = await driverStatusData(db, NOW);
    expect(status[driverId]?.onJob).toEqual({
      dropoff: 'Heathrow T5',
      untilMs: NOW.getTime() + 40 * MIN,
    });
    expect(status[driverId]?.next).toEqual({
      atMs: NOW.getTime() + 90 * MIN,
      pickup: 'Soho',
      dropoff: 'Gatwick',
    });
  });

  it('omits a driver whose only jobs are completed/cancelled (treated as free)', async () => {
    await seedAssigned({
      state: 'completed',
      pickupAt: new Date(NOW.getTime() - 180 * MIN),
      expectedDurationMinutes: 60,
    });
    const status = await driverStatusData(db, NOW);
    expect(status[driverId]).toBeUndefined();
  });

  it('reports free-with-next when the only job is upcoming', async () => {
    await seedAssigned({
      state: 'assigned',
      pickupAt: new Date(NOW.getTime() + 45 * MIN),
      expectedDurationMinutes: 90,
      pickupAddress: 'Mayfair',
      dropoffAddress: 'City',
    });
    const status = await driverStatusData(db, NOW);
    expect(status[driverId]?.onJob).toBeNull();
    expect(status[driverId]?.next?.pickup).toBe('Mayfair');
  });
});
