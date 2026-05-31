import { FakeNotificationAdapter } from '@/server/adapters/notification-fake';
import { bookings, dispatchOffers, drivers, operators } from '@/server/db/schema';
import { fixedClock } from '@/server/ports/clock';
import { cancelBooking } from '@/server/services/cancel';
import { acceptDispatchLink, generateDispatchLinks } from '@/server/services/dispatch';
import {
  lapseOpenOffers,
  openOffersForBookings,
  recordDispatchOffer,
  resolveOffersOnAccept,
} from '@/server/services/offers';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestDb, createTestDb } from '~test/helpers/pglite-db';

const SECRET = 'test-dispatch-secret-must-be-at-least-32-chars-long';
const APP_URL = 'https://example.test';

describe('services/offers (dispatch offer tracking)', () => {
  let db: TestDb;
  let close: () => Promise<void>;
  let operatorId: string;
  let driver1: string;
  let driver2: string;
  let driver3: string;
  let bookingId: string;
  let notifications: FakeNotificationAdapter;

  const clock = fixedClock('2026-05-18T10:00:00.000Z');
  const now = () => clock.now();
  const deps = () => ({ db, clock, notifications, secret: SECRET, appUrl: APP_URL });

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
    await db.delete(dispatchOffers);
    await db.delete(bookings);
    await db.delete(drivers);
    notifications = new FakeNotificationAdapter();

    const seedDriver = async (name: string, phone: string) => {
      const [d] = await db
        .insert(drivers)
        .values({ name, tier: 'ordinary', defaultCarType: 's_class', whatsappNumber: phone })
        .returning();
      return d?.id ?? '';
    };
    driver1 = await seedDriver('Tom', '+447911000001');
    driver2 = await seedDriver('Dee', '+447911000002');
    driver3 = await seedDriver('Sam', '+447911000003');

    const [b] = await db
      .insert(bookings)
      .values({
        pickupAt: new Date('2026-06-01T10:00:00.000Z'),
        expectedDurationMinutes: 90,
        pickupAddress: '11 Belsize Park Gardens, London',
        dropoffAddress: 'LHR Terminal 5',
        passengerFirstName: 'Eric',
        execMobile: '+447911999999',
        clientName: 'LEGO Group',
        accountCode: 'LEGO',
        contractPricePence: 30000,
      })
      .returning();
    bookingId = b?.id ?? '';
  });

  it('records an open offer for every driver in a fan-out', async () => {
    const r = await generateDispatchLinks(
      bookingId,
      [driver1, driver2, driver3],
      operatorId,
      deps(),
    );
    expect(r.ok).toBe(true);

    const map = await openOffersForBookings(db, [bookingId]);
    const open = map.get(bookingId) ?? [];
    expect(open.length).toBe(3);
    expect(open.map((o) => o.driverName).sort()).toEqual(['Dee', 'Sam', 'Tom']);
  });

  it('re-offering the same driver supersedes the previous open offer (counted once)', async () => {
    await recordDispatchOffer(db, { bookingId, driverId: driver1, jti: 'jti-1' }, now());
    await recordDispatchOffer(db, { bookingId, driverId: driver1, jti: 'jti-2' }, now());

    const map = await openOffersForBookings(db, [bookingId]);
    expect((map.get(bookingId) ?? []).length).toBe(1);

    const all = await db
      .select()
      .from(dispatchOffers)
      .where(eq(dispatchOffers.bookingId, bookingId));
    expect(all.length).toBe(2);
    expect(all.filter((o) => o.status === 'lapsed').length).toBe(1);
    expect(all.filter((o) => o.status === 'open').length).toBe(1);
  });

  it('on accept, the winner is accepted and the rest lapse (no open offers remain)', async () => {
    const r = await generateDispatchLinks(
      bookingId,
      [driver1, driver2, driver3],
      operatorId,
      deps(),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // driver2 accepts via their link.
    const offer2 = r.offers.find((o) => o.driver.id === driver2);
    const token = new URL(offer2?.url ?? '').pathname.split('/').pop() ?? '';
    const acc = await acceptDispatchLink({ token }, deps());
    expect(acc.ok).toBe(true);

    const rows = await db
      .select()
      .from(dispatchOffers)
      .where(eq(dispatchOffers.bookingId, bookingId));
    const byDriver = new Map(rows.map((o) => [o.driverId, o.status]));
    expect(byDriver.get(driver2)).toBe('accepted');
    expect(byDriver.get(driver1)).toBe('lapsed');
    expect(byDriver.get(driver3)).toBe('lapsed');

    const map = await openOffersForBookings(db, [bookingId]);
    expect(map.get(bookingId)).toBeUndefined();
  });

  it('cancelling the booking lapses every open offer', async () => {
    await generateDispatchLinks(bookingId, [driver1, driver2], operatorId, deps());
    const res = await cancelBooking(
      { bookingId, reason: 'Client called off the trip' },
      operatorId,
      { db, clock },
    );
    expect(res.ok).toBe(true);

    const map = await openOffersForBookings(db, [bookingId]);
    expect(map.get(bookingId)).toBeUndefined();
    const rows = await db
      .select()
      .from(dispatchOffers)
      .where(eq(dispatchOffers.bookingId, bookingId));
    expect(rows.every((o) => o.status === 'lapsed')).toBe(true);
  });

  it('openOffersForBookings returns an empty map for no ids', async () => {
    const map = await openOffersForBookings(db, []);
    expect(map.size).toBe(0);
  });

  it('lapseOpenOffers is a no-op when nothing is open', async () => {
    await expect(lapseOpenOffers(db, bookingId, now())).resolves.toBeUndefined();
    const map = await openOffersForBookings(db, [bookingId]);
    expect(map.get(bookingId)).toBeUndefined();
  });

  it('resolveOffersOnAccept is idempotent', async () => {
    await recordDispatchOffer(db, { bookingId, driverId: driver1, jti: 'a' }, now());
    await recordDispatchOffer(db, { bookingId, driverId: driver2, jti: 'b' }, now());
    await resolveOffersOnAccept(db, bookingId, driver1, now());
    await resolveOffersOnAccept(db, bookingId, driver1, now());

    const rows = await db
      .select()
      .from(dispatchOffers)
      .where(eq(dispatchOffers.bookingId, bookingId));
    expect(rows.find((o) => o.driverId === driver1)?.status).toBe('accepted');
    expect(rows.find((o) => o.driverId === driver2)?.status).toBe('lapsed');
  });

  it('scopes open offers to the requested bookings only', async () => {
    const [b2] = await db
      .insert(bookings)
      .values({
        pickupAt: new Date('2026-06-02T10:00:00.000Z'),
        expectedDurationMinutes: 60,
        pickupAddress: 'A',
        dropoffAddress: 'B',
        passengerFirstName: 'Pat',
        execMobile: '+447911999998',
        clientName: 'ACME',
        accountCode: 'ACME',
        contractPricePence: 20000,
      })
      .returning();
    const booking2 = b2?.id ?? '';
    await recordDispatchOffer(db, { bookingId, driverId: driver1, jti: 'x' }, now());
    await recordDispatchOffer(db, { bookingId: booking2, driverId: driver2, jti: 'y' }, now());

    const map = await openOffersForBookings(db, [bookingId]);
    expect((map.get(bookingId) ?? []).length).toBe(1);
    expect(map.get(booking2)).toBeUndefined();
  });
});
