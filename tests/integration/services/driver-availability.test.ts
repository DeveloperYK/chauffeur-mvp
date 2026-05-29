import { auditEvents, driverTimeOff, drivers, operators } from '@/server/db/schema';
import { driverDispatchData } from '@/server/services/bookings-query';
import {
  clearDriverTimeOff,
  isDriverOffOn,
  listDriverTimeOff,
  setDriverTimeOff,
} from '@/server/services/driver-availability';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestDb, createTestDb } from '~test/helpers/pglite-db';

describe('services/driver-availability (integration)', () => {
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
    await db.delete(auditEvents);
    await db.delete(driverTimeOff);
    await db.delete(drivers);
    const [drv] = await db
      .insert(drivers)
      .values({
        name: 'Tom',
        tier: 'premium',
        defaultCarType: 'Mercedes S-Class',
        whatsappNumber: '+447911000001',
      })
      .returning();
    driverId = drv?.id ?? '';
  });

  describe('setDriverTimeOff', () => {
    it('creates a row with the given inclusive date range', async () => {
      const r = await setDriverTimeOff(
        { driverId, startsOn: '2026-06-04', endsOn: '2026-06-07' },
        operatorId,
        { db },
      );
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.timeOff.startsOn).toBe('2026-06-04');
      expect(r.timeOff.endsOn).toBe('2026-06-07');
      expect(r.timeOff.driverId).toBe(driverId);

      const rows = await db.select().from(driverTimeOff);
      expect(rows.length).toBe(1);
      expect(rows[0]?.createdByOperatorId).toBe(operatorId);
    });

    it('accepts a single-day range (starts == ends)', async () => {
      const r = await setDriverTimeOff(
        { driverId, startsOn: '2026-06-04', endsOn: '2026-06-04' },
        operatorId,
        { db },
      );
      expect(r.ok).toBe(true);
    });

    it('writes a driver_time_off_set audit row', async () => {
      await setDriverTimeOff(
        { driverId, startsOn: '2026-06-04', endsOn: '2026-06-07' },
        operatorId,
        { db },
      );
      const events = await db.select().from(auditEvents);
      expect(events.some((e) => e.action === 'driver_time_off_set')).toBe(true);
    });

    it('rejects an inverted range (ends before starts)', async () => {
      const r = await setDriverTimeOff(
        { driverId, startsOn: '2026-06-07', endsOn: '2026-06-04' },
        operatorId,
        { db },
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('validation');
    });

    it('rejects an unknown driver', async () => {
      const r = await setDriverTimeOff(
        {
          driverId: '00000000-0000-0000-0000-000000000099',
          startsOn: '2026-06-04',
          endsOn: '2026-06-07',
        },
        operatorId,
        { db },
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('driver_not_found');
    });

    it('rejects malformed dates', async () => {
      const r = await setDriverTimeOff(
        { driverId, startsOn: 'not-a-date', endsOn: '2026-06-07' },
        operatorId,
        { db },
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('validation');
    });
  });

  describe('isDriverOffOn', () => {
    beforeEach(async () => {
      await setDriverTimeOff(
        { driverId, startsOn: '2026-06-04', endsOn: '2026-06-07' },
        operatorId,
        { db },
      );
    });

    it('returns true on the first day of the range (inclusive)', async () => {
      expect(await isDriverOffOn(db, driverId, '2026-06-04')).toBe(true);
    });

    it('returns true on the last day of the range (inclusive)', async () => {
      expect(await isDriverOffOn(db, driverId, '2026-06-07')).toBe(true);
    });

    it('returns true in the middle of the range', async () => {
      expect(await isDriverOffOn(db, driverId, '2026-06-06')).toBe(true);
    });

    it('returns false the day before the range', async () => {
      expect(await isDriverOffOn(db, driverId, '2026-06-03')).toBe(false);
    });

    it('returns false the day after the range', async () => {
      expect(await isDriverOffOn(db, driverId, '2026-06-08')).toBe(false);
    });

    it('returns true if any overlapping row matches', async () => {
      // Add a second, separate window — both should count.
      await setDriverTimeOff(
        { driverId, startsOn: '2026-07-01', endsOn: '2026-07-02' },
        operatorId,
        { db },
      );
      expect(await isDriverOffOn(db, driverId, '2026-07-01')).toBe(true);
      expect(await isDriverOffOn(db, driverId, '2026-06-15')).toBe(false);
    });
  });

  describe('listDriverTimeOff', () => {
    it('returns rows for the given driver within [from, to], inclusive of overlap', async () => {
      await setDriverTimeOff(
        { driverId, startsOn: '2026-06-04', endsOn: '2026-06-07' },
        operatorId,
        { db },
      );
      await setDriverTimeOff(
        { driverId, startsOn: '2026-06-20', endsOn: '2026-06-22' },
        operatorId,
        { db },
      );
      await setDriverTimeOff(
        { driverId, startsOn: '2026-08-01', endsOn: '2026-08-03' },
        operatorId,
        { db },
      );
      const r = await listDriverTimeOff(db, driverId, '2026-06-01', '2026-06-30');
      expect(r.length).toBe(2);
      expect(r.map((t) => t.startsOn).sort()).toEqual(['2026-06-04', '2026-06-20']);
    });

    it('returns rows that straddle the window edges', async () => {
      await setDriverTimeOff(
        { driverId, startsOn: '2026-05-30', endsOn: '2026-06-02' },
        operatorId,
        { db },
      );
      const r = await listDriverTimeOff(db, driverId, '2026-06-01', '2026-06-30');
      expect(r.length).toBe(1);
    });

    it('returns empty when no rows match', async () => {
      const r = await listDriverTimeOff(db, driverId, '2027-01-01', '2027-01-31');
      expect(r.length).toBe(0);
    });
  });

  describe('clearDriverTimeOff', () => {
    it('deletes the row by id and writes a cleared audit', async () => {
      const set = await setDriverTimeOff(
        { driverId, startsOn: '2026-06-04', endsOn: '2026-06-07' },
        operatorId,
        { db },
      );
      if (!set.ok) throw new Error('setup');

      const r = await clearDriverTimeOff(set.timeOff.id, operatorId, { db });
      expect(r.ok).toBe(true);

      const remaining = await db
        .select()
        .from(driverTimeOff)
        .where(eq(driverTimeOff.id, set.timeOff.id));
      expect(remaining.length).toBe(0);

      const events = await db.select().from(auditEvents);
      expect(events.some((e) => e.action === 'driver_time_off_cleared')).toBe(true);
    });

    it('returns not_found for an unknown id', async () => {
      const r = await clearDriverTimeOff('00000000-0000-0000-0000-000000000099', operatorId, {
        db,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('not_found');
    });
  });

  // driverDispatchData() is the query that feeds the dispatch picker. The
  // availability work threads `timeOff` through it without disturbing the
  // existing weekLoads / windows shape (V2 will remove weekLoads).
  describe('driverDispatchData.timeOff', () => {
    it('returns a timeOff map keyed by driver with the inclusive range', async () => {
      const fakeNow = new Date('2026-06-01T12:00:00.000Z');
      await setDriverTimeOff(
        { driverId, startsOn: '2026-06-04', endsOn: '2026-06-07' },
        operatorId,
        { db },
      );

      const r = await driverDispatchData(db, fakeNow);
      expect(r.timeOff[driverId]).toEqual([{ startsOn: '2026-06-04', endsOn: '2026-06-07' }]);
    });

    it('omits time-off rows that have already fully passed', async () => {
      const fakeNow = new Date('2026-07-15T12:00:00.000Z');
      await setDriverTimeOff(
        { driverId, startsOn: '2026-06-04', endsOn: '2026-06-07' },
        operatorId,
        { db },
      );
      await setDriverTimeOff(
        { driverId, startsOn: '2026-07-20', endsOn: '2026-07-22' },
        operatorId,
        { db },
      );

      const r = await driverDispatchData(db, fakeNow);
      expect(r.timeOff[driverId]).toEqual([{ startsOn: '2026-07-20', endsOn: '2026-07-22' }]);
    });

    it('keeps a range whose end is today (boundary)', async () => {
      const fakeNow = new Date('2026-06-07T22:00:00.000Z');
      await setDriverTimeOff(
        { driverId, startsOn: '2026-06-04', endsOn: '2026-06-07' },
        operatorId,
        { db },
      );

      const r = await driverDispatchData(db, fakeNow);
      expect(r.timeOff[driverId]?.length).toBe(1);
    });

    it('returns an empty object when no driver is off', async () => {
      const r = await driverDispatchData(db);
      expect(r.timeOff).toEqual({});
    });
  });
});
