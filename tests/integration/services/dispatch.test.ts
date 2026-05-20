import { FakeNotificationAdapter } from '@/server/adapters/notification-fake';
import { auditEvents, bookings, consumedTokens, drivers, operators } from '@/server/db/schema';
import { fixedClock } from '@/server/ports/clock';
import {
  acceptDispatchLink,
  declineDispatchLink,
  generateDispatchLink,
  previewDispatchLink,
} from '@/server/services/dispatch';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestDb, createTestDb } from '~test/helpers/pglite-db';

const SECRET = 'test-dispatch-secret-must-be-at-least-32-chars-long';
const APP_URL = 'https://example.test';

describe('services/dispatch (integration)', () => {
  let db: TestDb;
  let close: () => Promise<void>;
  let operatorId: string;
  let driverId: string;
  let driverWhatsapp: string;
  let bookingId: string;
  let notifications: FakeNotificationAdapter;

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
    await db.delete(consumedTokens);
    await db.delete(bookings);
    await db.delete(drivers);
    notifications = new FakeNotificationAdapter();

    driverWhatsapp = '+447911000001';
    const [drv] = await db
      .insert(drivers)
      .values({
        name: 'Tom',
        tier: 'premium',
        defaultCarType: 's_class',
        whatsappNumber: driverWhatsapp,
      })
      .returning();
    driverId = drv?.id ?? '';

    const [b] = await db
      .insert(bookings)
      .values({
        pickupAt: new Date('2026-06-01T10:00:00.000Z'),
        expectedDurationMinutes: 90,
        pickupAddress: '11 Belsize Park Gardens, London',
        dropoffAddress: 'LHR Terminal 5',
        passengerFirstName: 'Eric',
        passengerLastName: 'French',
        execMobile: '+447911999999',
        accountCode: 'LEGO',
        contractPricePence: 30000,
      })
      .returning();
    bookingId = b?.id ?? '';
  });

  const clock = fixedClock('2026-05-18T10:00:00.000Z');

  const deps = () => ({
    db,
    clock,
    notifications,
    secret: SECRET,
    appUrl: APP_URL,
  });

  it('generates a dispatch link and a wa.me URL', async () => {
    const r = await generateDispatchLink(bookingId, driverId, operatorId, deps());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.url.startsWith(`${APP_URL}/j/`)).toBe(true);
    expect(r.whatsappUrl.startsWith('https://wa.me/447911000001')).toBe(true);

    const events = await db.select().from(auditEvents);
    expect(events.length).toBe(1);
    expect(events[0]?.action).toBe('dispatch_link_generated');
  });

  it('refuses to generate for inactive driver', async () => {
    await db.update(drivers).set({ active: false }).where(eq(drivers.id, driverId));
    const r = await generateDispatchLink(bookingId, driverId, operatorId, deps());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('driver_inactive');
  });

  it('refuses to generate for non-unassigned booking', async () => {
    await db.update(bookings).set({ state: 'assigned' }).where(eq(bookings.id, bookingId));
    const r = await generateDispatchLink(bookingId, driverId, operatorId, deps());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('wrong_state');
  });

  it('refuses unknown booking/driver', async () => {
    const r1 = await generateDispatchLink(
      '00000000-0000-0000-0000-000000000099',
      driverId,
      operatorId,
      deps(),
    );
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.reason).toBe('booking_not_found');

    const r2 = await generateDispatchLink(
      bookingId,
      '00000000-0000-0000-0000-000000000099',
      operatorId,
      deps(),
    );
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toBe('driver_not_found');
  });

  it('accept transitions booking to assigned, captures car, sends SMS, consumes jti', async () => {
    const gen = await generateDispatchLink(bookingId, driverId, operatorId, deps());
    if (!gen.ok) throw new Error('setup');
    const token = new URL(gen.url).pathname.split('/').pop() ?? '';
    expect(token.length).toBeGreaterThan(20);

    const r = await acceptDispatchLink({ token }, deps());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.booking.state).toBe('assigned');
    expect(r.booking.assignedDriverId).toBe(driverId);
    expect(r.carForJob).toBe('s_class');

    // SMS sent
    expect(notifications.sent.length).toBe(1);
    expect(notifications.sent[0]?.to).toBe('+447911999999');
    expect(notifications.sent[0]?.body).toContain('Tom');

    // jti consumed
    expect((await db.select().from(consumedTokens)).length).toBe(1);

    // Audit entries (generate + accept)
    const events = await db.select().from(auditEvents);
    expect(events.some((e) => e.action === 'driver_accept')).toBe(true);
  });

  it('accept honours car override', async () => {
    const gen = await generateDispatchLink(bookingId, driverId, operatorId, deps());
    if (!gen.ok) throw new Error('setup');
    const token = new URL(gen.url).pathname.split('/').pop() ?? '';
    const r = await acceptDispatchLink({ token, carOverride: 'mpv' }, deps());
    expect(r.ok && r.carForJob).toBe('mpv');
  });

  it('accept refuses replay (token_consumed)', async () => {
    const gen = await generateDispatchLink(bookingId, driverId, operatorId, deps());
    if (!gen.ok) throw new Error('setup');
    const token = new URL(gen.url).pathname.split('/').pop() ?? '';
    await acceptDispatchLink({ token }, deps());
    const r = await acceptDispatchLink({ token }, deps());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('token_consumed');
  });

  it('accept rejects garbage token', async () => {
    const r = await acceptDispatchLink({ token: 'garbage.token.value' }, deps());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('token_invalid');
  });

  it('accept rejects expired token', async () => {
    const gen = await generateDispatchLink(bookingId, driverId, operatorId, deps());
    if (!gen.ok) throw new Error('setup');
    const token = new URL(gen.url).pathname.split('/').pop() ?? '';
    // Pickup +2d is the dispatch expiry; pickup 2026-06-01 → expiry 2026-06-03
    const wayLater = {
      db,
      clock: fixedClock('2026-06-04T00:00:00.000Z'),
      notifications,
      secret: SECRET,
      appUrl: APP_URL,
    };
    const r = await acceptDispatchLink({ token }, wayLater);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('token_expired');
  });

  it('decline records audit event but does not change state', async () => {
    const gen = await generateDispatchLink(bookingId, driverId, operatorId, deps());
    if (!gen.ok) throw new Error('setup');
    const token = new URL(gen.url).pathname.split('/').pop() ?? '';
    const r = await declineDispatchLink(token, deps());
    expect(r.ok).toBe(true);

    const [b] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(b?.state).toBe('unassigned');

    const declineEvents = (await db.select().from(auditEvents)).filter(
      (e) => e.action === 'driver_decline',
    );
    expect(declineEvents.length).toBe(1);
  });

  it('decline after state change errors', async () => {
    const gen = await generateDispatchLink(bookingId, driverId, operatorId, deps());
    if (!gen.ok) throw new Error('setup');
    const token = new URL(gen.url).pathname.split('/').pop() ?? '';
    await acceptDispatchLink({ token }, deps());
    const r = await declineDispatchLink(token, deps());
    expect(r.ok).toBe(false);
  });

  it('previewDispatchLink returns booking + driver for valid token', async () => {
    const gen = await generateDispatchLink(bookingId, driverId, operatorId, deps());
    if (!gen.ok) throw new Error('setup');
    const token = new URL(gen.url).pathname.split('/').pop() ?? '';
    const r = await previewDispatchLink(token, { db, clock, secret: SECRET, appUrl: APP_URL });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.preview.driver.id).toBe(driverId);
      expect(r.preview.booking.id).toBe(bookingId);
    }
  });

  it('previewDispatchLink rejects consumed token', async () => {
    const gen = await generateDispatchLink(bookingId, driverId, operatorId, deps());
    if (!gen.ok) throw new Error('setup');
    const token = new URL(gen.url).pathname.split('/').pop() ?? '';
    await acceptDispatchLink({ token }, deps());
    const r = await previewDispatchLink(token, { db, clock, secret: SECRET, appUrl: APP_URL });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('token_consumed');
  });
});
