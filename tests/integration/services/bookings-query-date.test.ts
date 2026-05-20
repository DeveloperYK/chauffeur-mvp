import { bookings, operators } from '@/server/db/schema';
import { listBookingsForDay, monthlyDayCounts } from '@/server/services/bookings-query';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestDb, createTestDb } from '~test/helpers/pglite-db';

describe('bookings-query date filtering (integration)', () => {
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

  const validBooking = (pickupAtIso: string, state: 'unassigned' | 'assigned' = 'unassigned') => ({
    state,
    pickupAt: new Date(pickupAtIso),
    expectedDurationMinutes: 60,
    pickupAddress: 'A',
    dropoffAddress: 'B',
    passengerFirstName: 'Eric',
    passengerLastName: 'French',
    execMobile: '+447911999999',
    accountCode: 'LEGO',
    contractPricePence: 30000,
  });

  describe('listBookingsForDay', () => {
    it('returns only bookings within the London day', async () => {
      // BST day: 14 May 2026, range is 13 May 23:00 UTC → 14 May 23:00 UTC.
      await db.insert(bookings).values([
        validBooking('2026-05-13T22:30:00Z'), // before London day start
        validBooking('2026-05-13T23:30:00Z'), // start of London 14th
        validBooking('2026-05-14T12:00:00Z'), // middle of London 14th
        validBooking('2026-05-14T22:59:00Z'), // last minute of London 14th
        validBooking('2026-05-14T23:30:00Z'), // London 15th
      ]);
      const rows = await listBookingsForDay(db, '2026-05-14');
      expect(rows.length).toBe(3);
      expect(rows[0]?.pickupAt.toISOString()).toBe('2026-05-13T23:30:00.000Z');
      expect(rows[2]?.pickupAt.toISOString()).toBe('2026-05-14T22:59:00.000Z');
    });

    it('returns empty for a malformed date', async () => {
      const rows = await listBookingsForDay(db, 'not-a-date');
      expect(rows).toEqual([]);
    });

    it('orders by pickup_at ascending', async () => {
      await db
        .insert(bookings)
        .values([
          validBooking('2026-01-15T14:00:00Z'),
          validBooking('2026-01-15T09:00:00Z'),
          validBooking('2026-01-15T11:00:00Z'),
        ]);
      const rows = await listBookingsForDay(db, '2026-01-15');
      expect(rows.map((r) => r.pickupAt.toISOString())).toEqual([
        '2026-01-15T09:00:00.000Z',
        '2026-01-15T11:00:00.000Z',
        '2026-01-15T14:00:00.000Z',
      ]);
    });
  });

  describe('monthlyDayCounts', () => {
    it('buckets bookings by London day and reports total + unassigned', async () => {
      await db.insert(bookings).values([
        validBooking('2026-05-14T09:00:00Z', 'unassigned'),
        validBooking('2026-05-14T15:00:00Z', 'unassigned'),
        validBooking('2026-05-14T17:00:00Z', 'assigned'),
        validBooking('2026-05-15T09:00:00Z', 'unassigned'),
        // Edge: 2026-05-31T23:30Z is already 2026-06-01 in London BST
        validBooking('2026-05-31T23:30:00Z', 'unassigned'),
      ]);

      const may = await monthlyDayCounts(db, '2026-05');
      expect(may.get('2026-05-14')).toEqual({ total: 3, unassigned: 2, dispatched: 1 });
      expect(may.get('2026-05-15')).toEqual({ total: 1, unassigned: 1, dispatched: 0 });
      expect(may.has('2026-06-01')).toBe(false);

      const jun = await monthlyDayCounts(db, '2026-06');
      expect(jun.get('2026-06-01')).toEqual({ total: 1, unassigned: 1, dispatched: 0 });
    });

    it('returns empty map for unknown month', async () => {
      const result = await monthlyDayCounts(db, 'not-a-month');
      expect(result.size).toBe(0);
    });

    it('handles GMT months too', async () => {
      await db
        .insert(bookings)
        .values([
          validBooking('2026-01-15T09:00:00Z', 'unassigned'),
          validBooking('2026-01-15T15:00:00Z', 'assigned'),
        ]);
      const jan = await monthlyDayCounts(db, '2026-01');
      expect(jan.get('2026-01-15')).toEqual({ total: 2, unassigned: 1, dispatched: 1 });
    });
  });
});
