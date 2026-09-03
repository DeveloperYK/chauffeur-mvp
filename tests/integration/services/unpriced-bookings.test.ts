import { bookings, operators } from '@/server/db/schema';
import { listUnpricedBookings } from '@/server/services/bookings-query';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestDb, createTestDb } from '~test/helpers/pglite-db';

describe('listUnpricedBookings (integration)', () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const t = await createTestDb();
    db = t.db;
    close = t.close;
    await db.insert(operators).values({ email: 'op@example.com', passwordHash: 'x', name: 'Op' });
  });

  afterAll(async () => {
    await close();
  });

  beforeEach(async () => {
    await db.delete(bookings);
  });

  const validBooking = (
    pickupAtIso: string,
    opts: {
      state?: 'unassigned' | 'assigned' | 'completed' | 'cancelled';
      contractPricePence?: number | null;
    } = {},
  ) => ({
    state: opts.state ?? 'unassigned',
    pickupAt: new Date(pickupAtIso),
    expectedDurationMinutes: 60,
    pickupAddress: 'A',
    dropoffAddress: 'B',
    passengerFirstName: 'Eric',
    passengerLastName: 'French',
    execMobile: '+447911999999',
    clientName: 'LEGO Group',
    accountCode: 'LEGO',
    contractPricePence: opts.contractPricePence === undefined ? null : opts.contractPricePence,
  });

  it('returns unpriced bookings across different days, ordered by pickup time', async () => {
    await db
      .insert(bookings)
      .values([
        validBooking('2026-05-16T10:00:00Z'),
        validBooking('2026-05-14T09:00:00Z'),
        validBooking('2026-05-15T12:00:00Z'),
      ]);
    const rows = await listUnpricedBookings(db);
    expect(rows.map((r) => r.pickupAt.toISOString())).toEqual([
      '2026-05-14T09:00:00.000Z',
      '2026-05-15T12:00:00.000Z',
      '2026-05-16T10:00:00.000Z',
    ]);
  });

  it('includes completed bookings that are still unpriced (they block invoicing)', async () => {
    await db
      .insert(bookings)
      .values([validBooking('2026-05-14T09:00:00Z', { state: 'completed' })]);
    const rows = await listUnpricedBookings(db);
    expect(rows.length).toBe(1);
    expect(rows[0]?.state).toBe('completed');
  });

  it('includes every live workflow state, not just unassigned', async () => {
    await db
      .insert(bookings)
      .values([
        validBooking('2026-05-14T09:00:00Z', { state: 'unassigned' }),
        validBooking('2026-05-14T10:00:00Z', { state: 'assigned' }),
      ]);
    const rows = await listUnpricedBookings(db);
    expect(rows.length).toBe(2);
  });

  it('excludes bookings that have a contract price', async () => {
    await db
      .insert(bookings)
      .values([
        validBooking('2026-05-14T09:00:00Z', { contractPricePence: 30000 }),
        validBooking('2026-05-14T10:00:00Z'),
      ]);
    const rows = await listUnpricedBookings(db);
    expect(rows.length).toBe(1);
    expect(rows[0]?.contractPricePence).toBeNull();
  });

  it('treats a £0 contract price as priced (0 is a deliberate value, not missing)', async () => {
    await db
      .insert(bookings)
      .values([validBooking('2026-05-14T09:00:00Z', { contractPricePence: 0 })]);
    const rows = await listUnpricedBookings(db);
    expect(rows).toEqual([]);
  });

  it('excludes cancelled bookings (they are never invoiced)', async () => {
    await db
      .insert(bookings)
      .values([validBooking('2026-05-14T09:00:00Z', { state: 'cancelled' })]);
    const rows = await listUnpricedBookings(db);
    expect(rows).toEqual([]);
  });

  it('returns empty when every booking is priced', async () => {
    await db
      .insert(bookings)
      .values([
        validBooking('2026-05-14T09:00:00Z', { contractPricePence: 25000 }),
        validBooking('2026-05-15T09:00:00Z', { contractPricePence: 40000 }),
      ]);
    const rows = await listUnpricedBookings(db);
    expect(rows).toEqual([]);
  });
});
