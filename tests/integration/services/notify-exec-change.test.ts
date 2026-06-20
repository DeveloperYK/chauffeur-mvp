import { FakeEmailAdapter } from '@/server/adapters/email-fake';
import { FakeNotificationAdapter } from '@/server/adapters/notification-fake';
import { bookings, drivers, execNotifications, operators } from '@/server/db/schema';
import { notifyExecOfChange } from '@/server/services/exec-notifications';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestDb, createTestDb } from '~test/helpers/pglite-db';

describe('services/exec-notifications — notifyExecOfChange (integration)', () => {
  let db: TestDb;
  let close: () => Promise<void>;
  let operatorId: string;
  let driverId: string;
  let notifications: FakeNotificationAdapter;
  let email: FakeEmailAdapter;

  const EXEC_EMAIL = 'eric@example.com';

  beforeAll(async () => {
    const t = await createTestDb();
    db = t.db;
    close = t.close;
    const [op] = await db
      .insert(operators)
      .values({ email: 'op@example.com', passwordHash: 'x', name: 'Op' })
      .returning();
    operatorId = op?.id ?? '';
    const [drv] = await db
      .insert(drivers)
      .values({
        name: 'Tom',
        vehicleClass: 'executive',
        car: 'Mercedes S-Class',
        carColour: 'Black',
        whatsappNumber: '+447900000001',
      })
      .returning();
    driverId = drv?.id ?? '';
  });

  afterAll(async () => {
    await close();
  });

  beforeEach(async () => {
    await db.delete(execNotifications);
    await db.delete(bookings);
    notifications = new FakeNotificationAdapter();
    email = new FakeEmailAdapter();
  });

  async function seed(opts: { assigned: boolean; execEmail: string | null }) {
    const [row] = await db
      .insert(bookings)
      .values({
        state: opts.assigned ? 'assigned' : 'unassigned',
        pickupAt: new Date('2026-06-01T10:00:00.000Z'),
        expectedDurationMinutes: 90,
        pickupAddress: '11 Belsize Park Gardens, London',
        dropoffAddress: 'LHR Terminal 5',
        passengerFirstName: 'Eric',
        execMobile: '+447911999999',
        execEmail: opts.execEmail,
        clientName: 'LEGO Group',
        accountCode: 'LEGO Group',
        contractPricePence: 30000,
        createdByOperatorId: operatorId,
        assignedOperatorId: opts.assigned ? operatorId : null,
        assignedDriverId: opts.assigned ? driverId : null,
      })
      .returning();
    if (!row) throw new Error('seed failed');
    return row;
  }

  it('emails the exec (never SMS) and records a `changed` attempt', async () => {
    const booking = await seed({ assigned: true, execEmail: EXEC_EMAIL });
    const res = await notifyExecOfChange({ db, notifications, email }, booking.id);
    expect(res.ok).toBe(true);

    // Emailed, not texted.
    expect(email.sent.some((m) => m.to === EXEC_EMAIL)).toBe(true);
    expect(email.sent[0]?.text.toLowerCase()).toContain('confirmed');
    expect(notifications.sent).toHaveLength(0);

    // Persisted as a `changed` email notification.
    const rows = await db
      .select()
      .from(execNotifications)
      .where(eq(execNotifications.bookingId, booking.id));
    expect(
      rows.some((r) => r.kind === 'changed' && r.channel === 'email' && r.status === 'sent'),
    ).toBe(true);
  });

  it('no-ops (no_email) when the booking has no exec email', async () => {
    const booking = await seed({ assigned: true, execEmail: null });
    const res = await notifyExecOfChange({ db, notifications, email }, booking.id);
    expect(res).toMatchObject({ ok: false, reason: 'no_email' });
    expect(email.sent).toHaveLength(0);
  });

  it('fails cleanly when the booking has no driver', async () => {
    const booking = await seed({ assigned: false, execEmail: EXEC_EMAIL });
    const res = await notifyExecOfChange({ db, notifications, email }, booking.id);
    expect(res).toMatchObject({ ok: false, reason: 'no_driver' });
  });

  it('fails cleanly for an unknown booking', async () => {
    const res = await notifyExecOfChange(
      { db, notifications, email },
      '00000000-0000-0000-0000-0000000000ff',
    );
    expect(res).toMatchObject({ ok: false, reason: 'booking_not_found' });
  });
});
