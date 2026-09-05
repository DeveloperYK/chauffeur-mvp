import { bookings, drivers, operators } from '@/server/db/schema';
import { listDriverNotToldBookings } from '@/server/services/bookings-query';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestDb, createTestDb } from '~test/helpers/pglite-db';

/**
 * The "Driver not told" saved view: every dispatched booking whose details
 * changed after dispatch and whose driver has not yet confirmed the new plan.
 */
describe('listDriverNotToldBookings (integration)', () => {
  let db: TestDb;
  let close: () => Promise<void>;
  let driverId: string;

  beforeAll(async () => {
    const t = await createTestDb();
    db = t.db;
    close = t.close;
    await db.insert(operators).values({ email: 'op@example.com', passwordHash: 'x', name: 'Op' });
    const [drv] = await db
      .insert(drivers)
      .values({
        name: 'Tom',
        vehicleClass: 'executive',
        car: 'Mercedes S-Class',
        carColour: 'Black',
        whatsappNumber: '+447900000001',
      })
      .returning();
    driverId = drv?.id ?? '';
  });

  afterAll(async () => {
    await close();
  });

  beforeEach(async () => {
    await db.delete(bookings);
  });

  const booking = (
    pickupAtIso: string,
    opts: {
      state?: 'unassigned' | 'assigned' | 'in_progress' | 'completed' | 'cancelled';
      change?: 'none' | 'pending' | 'confirmed';
    } = {},
  ) => ({
    state: opts.state ?? 'assigned',
    assignedDriverId: opts.state === 'unassigned' ? null : driverId,
    pickupAt: new Date(pickupAtIso),
    expectedDurationMinutes: 60,
    pickupAddress: 'A',
    dropoffAddress: 'B',
    passengerFirstName: 'Eric',
    passengerLastName: 'French',
    execMobile: '+447911999999',
    clientName: 'LEGO Group',
    accountCode: 'LEGO',
    contractPricePence: 10000,
    changeConfirmationStatus: opts.change ?? 'none',
  });

  it('returns pending bookings across days, ordered by pickup time', async () => {
    await db
      .insert(bookings)
      .values([
        booking('2026-05-16T10:00:00Z', { change: 'pending' }),
        booking('2026-05-14T09:00:00Z', { change: 'pending', state: 'in_progress' }),
      ]);
    const rows = await listDriverNotToldBookings(db);
    expect(rows.map((b) => b.pickupAt.toISOString())).toEqual([
      '2026-05-14T09:00:00.000Z',
      '2026-05-16T10:00:00.000Z',
    ]);
  });

  it('includes both assigned and in_progress bookings', async () => {
    await db
      .insert(bookings)
      .values([
        booking('2026-05-14T09:00:00Z', { change: 'pending', state: 'assigned' }),
        booking('2026-05-15T09:00:00Z', { change: 'pending', state: 'in_progress' }),
      ]);
    expect((await listDriverNotToldBookings(db)).map((b) => b.state)).toEqual([
      'assigned',
      'in_progress',
    ]);
  });

  it('excludes bookings whose driver has confirmed, or that were never changed', async () => {
    await db
      .insert(bookings)
      .values([
        booking('2026-05-14T09:00:00Z', { change: 'confirmed' }),
        booking('2026-05-15T09:00:00Z', { change: 'none' }),
      ]);
    expect(await listDriverNotToldBookings(db)).toEqual([]);
  });

  it('excludes bookings that are no longer dispatched even if the flag is still set', async () => {
    await db
      .insert(bookings)
      .values([
        booking('2026-05-14T09:00:00Z', { change: 'pending', state: 'completed' }),
        booking('2026-05-15T09:00:00Z', { change: 'pending', state: 'cancelled' }),
        booking('2026-05-16T09:00:00Z', { change: 'pending', state: 'unassigned' }),
      ]);
    expect(await listDriverNotToldBookings(db)).toEqual([]);
  });

  it('returns an empty list when nothing is pending', async () => {
    expect(await listDriverNotToldBookings(db)).toEqual([]);
  });
});
