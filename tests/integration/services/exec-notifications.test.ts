import { randomUUID } from 'node:crypto';
import { FakeNotificationAdapter } from '@/server/adapters/notification-fake';
import {
  type Booking,
  type Driver,
  auditEvents,
  bookings,
  drivers,
  execNotifications,
  operators,
} from '@/server/db/schema';
import { fixedClock } from '@/server/ports/clock';
import type { NotificationPort } from '@/server/ports/notifications';
import { handToBackfill } from '@/server/services/backfill';
import { clockTick } from '@/server/services/clock-tick';
import {
  listExecNotifications,
  resendExecNotification,
  sendExecNotification,
} from '@/server/services/exec-notifications';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SeedData } from '~test/fixtures/seed-data';
import { type TestDb, createTestDb } from '~test/helpers/pglite-db';

describe('services/exec-notifications (integration)', () => {
  let db: TestDb;
  let close: () => Promise<void>;
  let operatorId: string;
  let driver: Driver;
  let notifications: FakeNotificationAdapter;

  const deps = () => ({ db, notifications });

  async function seedAssigned(overrides = {}): Promise<Booking> {
    const [b] = await db
      .insert(bookings)
      .values(SeedData.bookings.assigned(operatorId, driver.id, overrides))
      .returning();
    if (!b) throw new Error('seed failed');
    return b;
  }

  async function status(bookingId: string) {
    const [b] = await db
      .select({ s: bookings.execNotificationStatus })
      .from(bookings)
      .where(eq(bookings.id, bookingId));
    return b?.s;
  }

  beforeAll(async () => {
    const t = await createTestDb();
    db = t.db;
    close = t.close;
    const [op] = await db
      .insert(operators)
      .values({ email: 'op@example.com', passwordHash: 'x', name: 'Op' })
      .returning();
    operatorId = op?.id ?? '';
    const [drv] = await db.insert(drivers).values(SeedData.drivers.premiumTom()).returning();
    if (!drv) throw new Error('driver seed failed');
    driver = drv;
  });

  afterAll(async () => {
    await close();
  });

  beforeEach(async () => {
    await db.delete(execNotifications);
    await db.delete(auditEvents);
    await db.delete(bookings);
    notifications = new FakeNotificationAdapter();
  });

  // ─── sendExecNotification ───────────────────────────────────────────────

  it('records a sent row and marks the booking ok on a successful send', async () => {
    const booking = await seedAssigned();
    const row = await sendExecNotification(deps(), {
      booking,
      kind: 'assigned',
      driverName: driver.name,
      car: 'Black Mercedes S-Class',
    });

    expect(row?.status).toBe('sent');
    expect(row?.channel).toBe('sms');
    expect(row?.kind).toBe('assigned');
    expect(row?.to).toBe(booking.execMobile);
    expect(row?.providerMessageId).toBeTruthy();
    expect(row?.errorReason).toBeNull();
    expect(row?.body).toContain('Black Mercedes S-Class');

    expect(await status(booking.id)).toBe('ok');
    expect(notifications.sent.length).toBe(1);
    expect(notifications.sent[0]?.to).toBe(booking.execMobile);
  });

  it('records a failed row and marks the booking failed when the provider rejects', async () => {
    const booking = await seedAssigned();
    notifications.simulateFailure('http_400');

    const row = await sendExecNotification(deps(), {
      booking,
      kind: 'assigned',
      driverName: driver.name,
      car: 'Black Mercedes S-Class',
    });

    expect(row?.status).toBe('failed');
    expect(row?.errorReason).toBe('http_400');
    expect(row?.providerMessageId).toBeNull();
    expect(await status(booking.id)).toBe('failed');
  });

  it('records a failed row (and does not throw) when the adapter throws', async () => {
    const booking = await seedAssigned();
    const throwingNotifier: NotificationPort = {
      async sendSms() {
        throw new Error('network exploded');
      },
    };

    const row = await sendExecNotification(
      { db, notifications: throwingNotifier },
      { booking, kind: 'en_route', driverName: driver.name },
    );

    expect(row?.status).toBe('failed');
    expect(row?.errorReason).toBe('exception');
    expect(await status(booking.id)).toBe('failed');
  });

  it('is best-effort: a persistence failure returns null without throwing', async () => {
    // A booking id with no row violates the FK, so the insert throws inside the
    // wrapper. The send may have happened; the wrapper must swallow the DB error.
    const booking = await seedAssigned();
    const ghost = { ...booking, id: randomUUID() };

    const row = await sendExecNotification(deps(), {
      booking: ghost,
      kind: 'assigned',
      driverName: driver.name,
      car: 'Black Mercedes S-Class',
    });

    expect(row).toBeNull();
    const all = await db.select().from(execNotifications);
    expect(all.length).toBe(0);
  });

  // ─── resendExecNotification ─────────────────────────────────────────────

  it('resends a failed message: new sent row, old superseded, booking cleared to ok', async () => {
    const booking = await seedAssigned();
    notifications.simulateFailure('http_500');
    const failed = await sendExecNotification(deps(), {
      booking,
      kind: 'assigned',
      driverName: driver.name,
      car: 'Black Mercedes S-Class',
    });
    expect(await status(booking.id)).toBe('failed');

    notifications.simulateFailure(null);
    const result = await resendExecNotification(deps(), failed?.id ?? '');

    expect(result.ok).toBe(true);
    expect(await status(booking.id)).toBe('ok');

    const rows = await listExecNotifications(db, booking.id);
    expect(rows.length).toBe(2);
    const old = rows.find((r) => r.id === failed?.id);
    expect(old?.status).toBe('superseded');
    expect(rows.some((r) => r.status === 'sent')).toBe(true);
  });

  it('leaves the booking failed when only one of two failed kinds is resent', async () => {
    const booking = await seedAssigned();
    // assigned ok
    await sendExecNotification(deps(), {
      booking,
      kind: 'assigned',
      driverName: driver.name,
      car: 'Black Mercedes S-Class',
    });
    // en_route fails
    notifications.simulateFailure('timeout');
    const enRouteFailed = await sendExecNotification(deps(), {
      booking,
      kind: 'en_route',
      driverName: driver.name,
    });
    expect(await status(booking.id)).toBe('failed');

    // Resend the en_route one successfully → no outstanding failures left.
    notifications.simulateFailure(null);
    await resendExecNotification(deps(), enRouteFailed?.id ?? '');
    expect(await status(booking.id)).toBe('ok');
  });

  it('returns not_found resending an unknown id', async () => {
    const result = await resendExecNotification(deps(), randomUUID());
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('returns no_driver when the booking has no driver to name', async () => {
    // Unassigned booking (no driver, not backfill) — can't rebuild the message.
    const [booking] = await db
      .insert(bookings)
      .values(SeedData.bookings.unassigned(operatorId))
      .returning();
    const [row] = await db
      .insert(execNotifications)
      .values({
        bookingId: booking?.id ?? '',
        channel: 'sms',
        kind: 'assigned',
        to: booking?.execMobile ?? '',
        body: 'x',
        status: 'failed',
        errorReason: 'http_500',
      })
      .returning();

    const result = await resendExecNotification(deps(), row?.id ?? '');
    expect(result).toEqual({ ok: false, reason: 'no_driver' });
  });

  // ─── call-site wiring ───────────────────────────────────────────────────

  it('clock-tick en-route send is recorded (call site wired)', async () => {
    const booking = await seedAssigned({ pickupAt: new Date('2026-05-18T10:00:00.000Z') });
    const clock = fixedClock('2026-05-18T09:00:00.000Z'); // T-1h
    await clockTick({ db, clock, notifications });

    const rows = await listExecNotifications(db, booking.id);
    expect(rows.length).toBe(1);
    expect(rows[0]?.kind).toBe('en_route');
    expect(rows[0]?.channel).toBe('sms');
    expect(await status(booking.id)).toBe('ok');
  });

  it('hand-to-backfill exec confirmation is recorded (call site wired)', async () => {
    const [booking] = await db
      .insert(bookings)
      .values(SeedData.bookings.unassigned(operatorId))
      .returning();
    const result = await handToBackfill(
      booking?.id ?? '',
      { name: 'Sub Sam', phone: '+447900111222', car: 'Black BMW 5', payPence: 9000 },
      operatorId,
      { db, clock: fixedClock('2026-05-18T10:00:00.000Z'), notifications },
    );
    expect(result.ok).toBe(true);

    const rows = await listExecNotifications(db, booking?.id ?? '');
    expect(rows.length).toBe(1);
    expect(rows[0]?.kind).toBe('assigned');
    expect(rows[0]?.body).toContain('Sub Sam');
    expect(await status(booking?.id ?? '')).toBe('ok');
  });
});
