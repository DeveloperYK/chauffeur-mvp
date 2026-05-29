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

  it('refuses to generate once booking is past assigned (in_progress)', async () => {
    // Driver-swap is allowed during 'assigned' (see swap-path tests below); once
    // the booking is in progress, picking a different driver is out of scope.
    await db.update(bookings).set({ state: 'in_progress' }).where(eq(bookings.id, bookingId));
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
  // Driver swap during the 'assigned' state.
  //
  // The 24-hours-out scenario: an already-assigned driver tells the operator
  // they can't make the job. Operator picks a different driver, who taps the
  // link to accept the swap. The previously-assigned driver gets one SMS
  // letting them know they're off; the exec is re-SMS'd with the new driver's
  // name + car so the original confirmation isn't left stale.
  // -----------------------------------------------------------------------
  describe('swap during assigned state', () => {
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

    it('generates a swap link when booking is assigned', async () => {
      // Set the booking up as already assigned to the original driver.
      await db
        .update(bookings)
        .set({
          state: 'assigned',
          assignedDriverId: driverId,
          assignedAt: clock.now(),
        })
        .where(eq(bookings.id, bookingId));

      const r = await generateDispatchLink(bookingId, secondDriverId, operatorId, deps());
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url.startsWith(`${APP_URL}/j/`)).toBe(true);
    });

    it('refuses to generate a swap link to the same driver (no-op)', async () => {
      await db
        .update(bookings)
        .set({ state: 'assigned', assignedDriverId: driverId, assignedAt: clock.now() })
        .where(eq(bookings.id, bookingId));

      const r = await generateDispatchLink(bookingId, driverId, operatorId, deps());
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('same_driver');
    });

    it('accept on a swap link flips driver, SMS’s old driver, re-SMS’s exec, writes driver_swap audit', async () => {
      // Stage: booking is assigned to original driver. (Skip the real accept
      // flow for the original — set directly so the test focuses on the swap.)
      await db
        .update(bookings)
        .set({
          state: 'assigned',
          assignedDriverId: driverId,
          assignedAt: clock.now(),
          carForThisJob: 's_class',
        })
        .where(eq(bookings.id, bookingId));

      const gen = await generateDispatchLink(bookingId, secondDriverId, operatorId, deps());
      if (!gen.ok) throw new Error('setup: generate failed');
      const token = new URL(gen.url).pathname.split('/').pop() ?? '';

      const r = await acceptDispatchLink({ token }, deps());
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      // Booking now points at the new driver, state stays 'assigned', car
      // reflects the new driver's default unless overridden.
      expect(r.booking.state).toBe('assigned');
      expect(r.booking.assignedDriverId).toBe(secondDriverId);
      expect(r.carForJob).toBe('mpv');

      // Two SMS: old driver "you're off" + exec re-confirmation with new driver.
      const messages = notifications.sent;
      expect(messages.length).toBe(2);
      const toOldDriver = messages.find((m) => m.to === driverWhatsapp);
      const toExec = messages.find((m) => m.to === '+447911999999');
      expect(toOldDriver?.body).toContain('reassigned');
      expect(toExec?.body).toContain('Marcus');

      // Audit captures the swap (not a fresh driver_accept).
      const events = await db.select().from(auditEvents);
      const swap = events.find((e) => e.action === 'driver_swap');
      expect(swap).toBeDefined();
      expect((swap?.before as { driverId?: string } | null)?.driverId).toBe(driverId);
      expect((swap?.after as { driverId?: string } | null)?.driverId).toBe(secondDriverId);
      // We did NOT also write a driver_accept event for the swap.
      expect(events.filter((e) => e.action === 'driver_accept').length).toBe(0);
    });

    it('swap accept honours car override', async () => {
      await db
        .update(bookings)
        .set({
          state: 'assigned',
          assignedDriverId: driverId,
          assignedAt: clock.now(),
          carForThisJob: 's_class',
        })
        .where(eq(bookings.id, bookingId));
      const gen = await generateDispatchLink(bookingId, secondDriverId, operatorId, deps());
      if (!gen.ok) throw new Error('setup');
      const token = new URL(gen.url).pathname.split('/').pop() ?? '';
      const r = await acceptDispatchLink({ token, carOverride: 's_class' }, deps());
      expect(r.ok && r.carForJob).toBe('s_class');
    });

    it('swap accept is refused if the booking has moved past assigned (e.g. cancelled or in_progress)', async () => {
      // Operator mints a swap link, but before the new driver taps accept the
      // booking has already moved on (cancelled by the customer, or the clock
      // ticked it to in_progress). Accepting the swap must not retroactively
      // un-cancel or reassign an in-progress trip.
      await db
        .update(bookings)
        .set({ state: 'assigned', assignedDriverId: driverId, assignedAt: clock.now() })
        .where(eq(bookings.id, bookingId));
      const gen = await generateDispatchLink(bookingId, secondDriverId, operatorId, deps());
      if (!gen.ok) throw new Error('setup');
      const token = new URL(gen.url).pathname.split('/').pop() ?? '';

      await db.update(bookings).set({ state: 'cancelled' }).where(eq(bookings.id, bookingId));

      const r = await acceptDispatchLink({ token }, deps());
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('wrong_state');
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
