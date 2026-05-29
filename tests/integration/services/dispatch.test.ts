import { FakeNotificationAdapter } from '@/server/adapters/notification-fake';
import { auditEvents, bookings, consumedTokens, drivers, operators } from '@/server/db/schema';
import { fixedClock } from '@/server/ports/clock';
import {
  acceptDispatchLink,
  declineDispatchLink,
  generateDispatchLink,
  previewDispatchLink,
  releaseDriver,
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
        clientName: 'LEGO Group',
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

    // Generating the link does NOT auto-text the driver (sent explicitly later).
    expect(notifications.sent.length).toBe(0);
  });

  it('refuses to generate for inactive driver', async () => {
    await db.update(drivers).set({ active: false }).where(eq(drivers.id, driverId));
    const r = await generateDispatchLink(bookingId, driverId, operatorId, deps());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('driver_inactive');
  });

  it('refuses to generate once a driver is assigned or the trip has moved on', async () => {
    // Dispatch is unassigned-only. Reassigning a pulled-out driver goes through
    // releaseDriver first (assigned → unassigned), so an already-assigned or
    // in-progress booking can't be dispatched directly.
    for (const state of ['assigned', 'in_progress'] as const) {
      await db.update(bookings).set({ state }).where(eq(bookings.id, bookingId));
      const r = await generateDispatchLink(bookingId, driverId, operatorId, deps());
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('wrong_state');
    }
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

    // SMS: only the exec confirmation on accept (dispatch link is not auto-texted).
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

  // -----------------------------------------------------------------------
  // Driver pulled out → releaseDriver (assigned → unassigned), then re-dispatch.
  //
  // The 24-hours-out scenario: an already-assigned driver tells the operator
  // they can't make the job. The operator releases them — the booking goes back
  // to 'unassigned' so it re-enters the queue, the dropped driver is SMS'd that
  // they're off — and then a fresh dispatch link is sent to someone else via
  // the normal accept path. There is no in-place "swap".
  // -----------------------------------------------------------------------
  describe('releaseDriver (driver pulled out)', () => {
    let secondDriverId: string;

    beforeEach(async () => {
      const [drv2] = await db
        .insert(drivers)
        .values({
          name: 'Marcus',
          tier: 'premium',
          defaultCarType: 'mpv',
          whatsappNumber: '+447911000002',
        })
        .returning();
      secondDriverId = drv2?.id ?? '';
    });

    const assignToFirstDriver = () =>
      db
        .update(bookings)
        .set({
          state: 'assigned',
          assignedDriverId: driverId,
          assignedAt: clock.now(),
          carForThisJob: 's_class',
          flaggedAt: clock.now(),
        })
        .where(eq(bookings.id, bookingId));

    it('moves assigned → unassigned, clears the driver, SMS’s them, writes driver_released audit', async () => {
      await assignToFirstDriver();

      const r = await releaseDriver(bookingId, operatorId, deps());
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      // Back in the queue with no driver, and the no-accept flag reset.
      expect(r.booking.state).toBe('unassigned');
      expect(r.booking.assignedDriverId).toBeNull();
      expect(r.booking.carForThisJob).toBeNull();
      expect(r.booking.assignedAt).toBeNull();
      expect(r.booking.flaggedAt).toBeNull();

      // The dropped driver is told they're off; the exec is NOT messaged.
      const messages = notifications.sent;
      expect(messages.length).toBe(1);
      expect(messages[0]?.to).toBe(driverWhatsapp);
      expect(messages[0]?.body).toContain('reassigned');

      const events = await db.select().from(auditEvents);
      const released = events.find((e) => e.action === 'driver_released');
      expect(released).toBeDefined();
      expect((released?.before as { driverId?: string } | null)?.driverId).toBe(driverId);
      expect((released?.after as { driverId?: string | null } | null)?.driverId).toBeNull();
    });

    it('refuses to release a booking that is not assigned', async () => {
      for (const state of ['unassigned', 'in_progress'] as const) {
        await db
          .update(bookings)
          .set({ state, assignedDriverId: state === 'in_progress' ? driverId : null })
          .where(eq(bookings.id, bookingId));
        const r = await releaseDriver(bookingId, operatorId, deps());
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toBe('wrong_state');
      }
    });

    it('refuses to release an unknown booking', async () => {
      const r = await releaseDriver('00000000-0000-0000-0000-000000000099', operatorId, deps());
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('booking_not_found');
    });

    it('two-step reassign: release, then a new driver accepts via the normal path', async () => {
      await assignToFirstDriver();

      // Step 1: release the original driver.
      const rel = await releaseDriver(bookingId, operatorId, deps());
      expect(rel.ok).toBe(true);

      // Step 2: dispatch a different driver and have them accept.
      const gen = await generateDispatchLink(bookingId, secondDriverId, operatorId, deps());
      expect(gen.ok).toBe(true);
      if (!gen.ok) return;
      const token = new URL(gen.url).pathname.split('/').pop() ?? '';

      const acc = await acceptDispatchLink({ token }, deps());
      expect(acc.ok).toBe(true);
      if (!acc.ok) return;
      expect(acc.booking.state).toBe('assigned');
      expect(acc.booking.assignedDriverId).toBe(secondDriverId);
      expect(acc.carForJob).toBe('mpv');

      // Exec gets the standard confirmation with the new driver on accept.
      const toExec = notifications.sent.find((m) => m.to === '+447911999999');
      expect(toExec?.body).toContain('Marcus');

      // Audit shows a normal accept for the new driver (not a bespoke swap).
      const events = await db.select().from(auditEvents);
      expect(events.some((e) => e.action === 'driver_released')).toBe(true);
      expect(events.some((e) => e.action === 'driver_accept')).toBe(true);
    });
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
