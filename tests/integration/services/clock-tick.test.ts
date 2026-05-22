import { FakeNotificationAdapter } from '@/server/adapters/notification-fake';
import { auditEvents, bookings, drivers, operators } from '@/server/db/schema';
import { fixedClock } from '@/server/ports/clock';
import { clockTick } from '@/server/services/clock-tick';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestDb, createTestDb } from '~test/helpers/pglite-db';

describe('services/clock-tick (integration)', () => {
  let db: TestDb;
  let close: () => Promise<void>;
  let driverId: string;
  let notifications: FakeNotificationAdapter;

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
    await db.delete(auditEvents);
    await db.delete(bookings);
    await db.delete(drivers);
    notifications = new FakeNotificationAdapter();
    const [drv] = await db
      .insert(drivers)
      .values({
        name: 'Tom',
        tier: 'premium',
        defaultCarType: 's_class',
        whatsappNumber: '+447911000001',
      })
      .returning();
    driverId = drv?.id ?? '';
  });

  async function seedBooking(
    state: 'unassigned' | 'assigned' | 'in_progress',
    pickupAtISO: string,
    createdAtISO?: string,
  ) {
    const [b] = await db
      .insert(bookings)
      .values({
        state,
        pickupAt: new Date(pickupAtISO),
        expectedDurationMinutes: 60,
        pickupAddress: 'A',
        dropoffAddress: 'B',
        passengerFirstName: 'Eric',
        passengerLastName: 'French',
        execMobile: '+447911999999',
        clientName: 'LEGO Group',
        accountCode: 'LEGO',
        contractPricePence: 30000,
        assignedDriverId: state === 'unassigned' ? null : driverId,
        carForThisJob: state === 'unassigned' ? null : 's_class',
        ...(createdAtISO ? { createdAt: new Date(createdAtISO) } : {}),
      })
      .returning();
    return b?.id ?? '';
  }

  it('assigned → in_progress at T-1h, fires en-route SMS', async () => {
    const id = await seedBooking('assigned', '2026-05-18T10:00:00.000Z');
    const now = fixedClock('2026-05-18T09:00:00.000Z');
    const report = await clockTick({ db, clock: now, notifications });
    expect(report.assignedToInProgress).toEqual([id]);
    const [b] = await db.select().from(bookings).where(eq(bookings.id, id));
    expect(b?.state).toBe('in_progress');
    expect(notifications.sent.length).toBe(1);
    expect(notifications.sent[0]?.body).toContain('en route');
  });

  it('does not transition assigned before T-1h', async () => {
    await seedBooking('assigned', '2026-05-18T10:00:00.000Z');
    const now = fixedClock('2026-05-18T08:00:00.000Z'); // 2 hours before, 1 hour before threshold
    const report = await clockTick({ db, clock: now, notifications });
    expect(report.assignedToInProgress).toEqual([]);
    expect(notifications.sent.length).toBe(0);
  });

  it('in_progress → awaiting_driver_form at T+expected_end', async () => {
    const id = await seedBooking('in_progress', '2026-05-18T10:00:00.000Z');
    const now = fixedClock('2026-05-18T11:00:00.000Z'); // pickup + 60min duration
    const report = await clockTick({ db, clock: now, notifications });
    expect(report.inProgressToAwaitingDriverForm).toEqual([id]);
    const [b] = await db.select().from(bookings).where(eq(bookings.id, id));
    expect(b?.state).toBe('awaiting_driver_form');
  });

  it('does not transition in_progress before expected end', async () => {
    await seedBooking('in_progress', '2026-05-18T10:00:00.000Z');
    const now = fixedClock('2026-05-18T10:30:00.000Z');
    const report = await clockTick({ db, clock: now, notifications });
    expect(report.inProgressToAwaitingDriverForm).toEqual([]);
  });

  it('flags unaccepted unassigned booking after 24h window', async () => {
    // Note: drizzle's default for createdAt is now() at insert. We supply
    // a past createdAt explicitly to simulate a stale booking.
    const id = await seedBooking(
      'unassigned',
      '2026-05-25T10:00:00.000Z',
      '2026-05-17T10:00:00.000Z',
    );
    const now = fixedClock('2026-05-18T11:00:00.000Z'); // ~25h later
    const report = await clockTick({ db, clock: now, notifications });
    expect(report.flaggedUnaccepted).toEqual([id]);
    const [b] = await db.select().from(bookings).where(eq(bookings.id, id));
    expect(b?.flaggedAt).not.toBeNull();
  });

  it('does not flag the same booking twice (idempotent)', async () => {
    const id = await seedBooking(
      'unassigned',
      '2026-05-25T10:00:00.000Z',
      '2026-05-17T10:00:00.000Z',
    );
    const now = fixedClock('2026-05-18T11:00:00.000Z');
    const r1 = await clockTick({ db, clock: now, notifications });
    const r2 = await clockTick({ db, clock: now, notifications });
    expect(r1.flaggedUnaccepted).toEqual([id]);
    expect(r2.flaggedUnaccepted).toEqual([]);
    const flagAudits = (await db.select().from(auditEvents)).filter(
      (e) => e.action === 'auto_flag_no_accept',
    );
    expect(flagAudits.length).toBe(1);
  });

  it('respects custom noAcceptWindowMs', async () => {
    const id = await seedBooking(
      'unassigned',
      '2026-05-25T10:00:00.000Z',
      '2026-05-18T10:00:00.000Z',
    );
    const now = fixedClock('2026-05-18T10:30:00.000Z'); // 30 min later
    const report = await clockTick({
      db,
      clock: now,
      notifications,
      noAcceptWindowMs: 15 * 60 * 1000, // 15 min
    });
    expect(report.flaggedUnaccepted).toEqual([id]);
  });

  it('records system audit events for clock transitions', async () => {
    await seedBooking('assigned', '2026-05-18T10:00:00.000Z');
    const now = fixedClock('2026-05-18T09:00:00.000Z');
    await clockTick({ db, clock: now, notifications });
    const sysEvents = (await db.select().from(auditEvents)).filter((e) => e.actorType === 'system');
    expect(sysEvents.length).toBe(1);
    expect(sysEvents[0]?.action).toBe('clock_pickup_minus_1h');
  });

  it('full lifecycle: assigned → in_progress → awaiting_driver_form across two ticks', async () => {
    const id = await seedBooking('assigned', '2026-05-18T10:00:00.000Z');

    await clockTick({ db, clock: fixedClock('2026-05-18T09:00:00.000Z'), notifications });
    let row = (await db.select().from(bookings).where(eq(bookings.id, id)))[0];
    expect(row?.state).toBe('in_progress');

    await clockTick({ db, clock: fixedClock('2026-05-18T11:00:00.000Z'), notifications });
    row = (await db.select().from(bookings).where(eq(bookings.id, id)))[0];
    expect(row?.state).toBe('awaiting_driver_form');
  });
});
