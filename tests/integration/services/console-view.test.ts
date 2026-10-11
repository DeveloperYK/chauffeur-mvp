import { bookings, dispatchOffers, drivers, operators } from '@/server/db/schema';
import {
  loadAttentionView,
  loadBookingView,
  loadDayView,
  toConsoleBooking,
} from '@/server/services/console-view';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestDb, createTestDb } from '~test/helpers/pglite-db';

/**
 * Read models for the console surfaces (board + mobile shell): a booking row
 * serialised for the client, plus the drivers / operators / busy windows the
 * dispatch flow needs, in one call per screen.
 */
describe('services/console-view (integration)', () => {
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
      .values({ email: 'op@example.com', passwordHash: 'x', name: 'Op One' })
      .returning();
    operatorId = op?.id ?? '';
    const [d] = await db
      .insert(drivers)
      .values({
        name: 'Mario Rossi',
        whatsappNumber: '+447700900001',
        vehicleClass: 'executive',
        car: 'Mercedes E-Class',
        carColour: 'Grey',
        active: true,
      })
      .returning();
    driverId = d?.id ?? '';
  });

  afterAll(async () => {
    await close();
  });

  beforeEach(async () => {
    await db.delete(dispatchOffers);
    await db.delete(bookings);
  });

  async function seed(pickupAt: Date, overrides: Partial<typeof bookings.$inferInsert> = {}) {
    const [row] = await db
      .insert(bookings)
      .values({
        state: 'unassigned',
        expectedDurationMinutes: 90,
        pickupAddress: '11 Belsize Park Gardens, London NW3 4JJ',
        dropoffAddress: 'Heathrow T5',
        passengerFirstName: 'Eric',
        passengerLastName: 'French',
        execMobile: '+447911123456',
        clientName: 'LEGO Group',
        accountCode: 'LEGO Group',
        caseCode: 'LEGO-2026-001',
        contractPricePence: 30000,
        pickupAt,
        createdByOperatorId: operatorId,
        ...overrides,
      })
      .returning();
    if (!row) throw new Error('seed failed');
    return row;
  }

  describe('toConsoleBooking', () => {
    it('serialises dates to ISO strings and derives the waiting fee', async () => {
      const row = await seed(new Date('2026-10-13T09:00:00Z'), { waitingTimeMinutes: 25 });
      const c = toConsoleBooking(row);
      expect(c.pickupAt).toBe('2026-10-13T09:00:00.000Z');
      expect(c.dropoffAddress).toBe('Heathrow T5');
      expect(c.waitingFee.chargeableMinutes).toBeGreaterThan(0);
      expect(c.openOffers).toEqual([]);
      expect(c.confirmationEmailSentAt).toBeNull();
    });
    it('turns a null drop-off (hourly hire) into an empty string', async () => {
      const row = await seed(new Date('2026-10-13T09:00:00Z'), {
        serviceType: 'hourly',
        dropoffAddress: null,
      });
      expect(toConsoleBooking(row).dropoffAddress).toBe('');
    });
  });

  describe('loadBookingView', () => {
    it('returns the booking with roster, operators and busy windows', async () => {
      const row = await seed(new Date('2026-10-13T09:00:00Z'));
      await seed(new Date('2026-10-13T11:00:00Z'), {
        state: 'assigned',
        assignedDriverId: driverId,
      });
      const view = await loadBookingView(db, row.id);
      expect(view?.booking.id).toBe(row.id);
      expect(view?.drivers.map((d) => d.name)).toEqual(['Mario Rossi']);
      expect(view?.operators.map((o) => o.name)).toEqual(['Op One']);
      expect(view?.assignments).toEqual([
        {
          driverId,
          startMs: Date.parse('2026-10-13T11:00:00Z'),
          endMs: Date.parse('2026-10-13T12:30:00Z'),
        },
      ]);
    });
    it('includes open dispatch offers on the booking', async () => {
      const row = await seed(new Date('2026-10-13T09:00:00Z'));
      await db.insert(dispatchOffers).values({
        bookingId: row.id,
        driverId,
        jti: 'jti-1',
        status: 'open',
      });
      const view = await loadBookingView(db, row.id);
      expect(view?.booking.openOffers).toEqual([{ driverId, driverName: 'Mario Rossi' }]);
    });
    it('returns null for an unknown id', async () => {
      expect(await loadBookingView(db, '00000000-0000-4000-8000-000000000000')).toBeNull();
    });
    it('returns null for a malformed id rather than throwing', async () => {
      expect(await loadBookingView(db, 'not-a-uuid')).toBeNull();
    });
  });

  describe('loadDayView', () => {
    it("returns the London day's bookings in pickup order with the roster", async () => {
      await seed(new Date('2026-10-13T10:00:00Z'));
      await seed(new Date('2026-10-13T07:00:00Z'));
      await seed(new Date('2026-10-14T07:00:00Z'));
      const view = await loadDayView(db, '2026-10-13');
      expect(view.bookings.map((b) => b.pickupAt)).toEqual([
        '2026-10-13T07:00:00.000Z',
        '2026-10-13T10:00:00.000Z',
      ]);
      expect(view.drivers).toHaveLength(1);
      expect(view.operators).toHaveLength(1);
    });
    it('is empty for a day with nothing booked or an invalid day string', async () => {
      expect((await loadDayView(db, '2030-01-01')).bookings).toEqual([]);
      expect((await loadDayView(db, 'nope')).bookings).toEqual([]);
    });
  });

  describe('loadAttentionView', () => {
    it('lists, across days, what needs the operator: unassigned, awaiting review, driver not told', async () => {
      const review = await seed(new Date('2026-10-14T09:00:00Z'), {
        state: 'awaiting_operator_review',
        assignedDriverId: driverId,
      });
      const fine = await seed(new Date('2026-10-13T08:00:00Z'), {
        state: 'assigned',
        assignedDriverId: driverId,
      });
      const notTold = await seed(new Date('2026-10-13T12:00:00Z'), {
        state: 'assigned',
        assignedDriverId: driverId,
        changeConfirmationStatus: 'pending',
      });
      const open = await seed(new Date('2026-10-15T09:00:00Z'));
      const view = await loadAttentionView(db);
      expect(view.bookings.map((b) => b.id)).toEqual([notTold.id, review.id, open.id]);
      expect(view.bookings.map((b) => b.id)).not.toContain(fine.id);
    });
    it('is empty when nothing needs attention', async () => {
      await seed(new Date('2026-10-13T08:00:00Z'), { state: 'completed' });
      expect((await loadAttentionView(db)).bookings).toEqual([]);
    });
  });
});
