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

  const EXEC = '+447911999999';

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
  });

  async function seed(assigned: boolean) {
    const [row] = await db
      .insert(bookings)
      .values({
        state: assigned ? 'assigned' : 'unassigned',
        pickupAt: new Date('2026-06-01T10:00:00.000Z'),
        expectedDurationMinutes: 90,
        pickupAddress: '11 Belsize Park Gardens, London',
        dropoffAddress: 'LHR Terminal 5',
        passengerFirstName: 'Eric',
        execMobile: EXEC,
        clientName: 'LEGO Group',
        accountCode: 'LEGO Group',
        contractPricePence: 30000,
        createdByOperatorId: operatorId,
        assignedOperatorId: operatorId,
        assignedDriverId: assigned ? driverId : null,
      })
      .returning();
    if (!row) throw new Error('seed failed');
    return row;
  }

  it('sends a `changed` exec SMS and records the attempt', async () => {
    const booking = await seed(true);
    const res = await notifyExecOfChange({ db, notifications }, booking.id);
    expect(res.ok).toBe(true);

    // Exec was texted the update.
    const execMsg = notifications.sent.find((m) => m.to === EXEC);
    expect(execMsg).toBeTruthy();
    expect(execMsg?.body.toLowerCase()).toContain('updated');

    // Attempt persisted as a `changed` notification.
    const rows = await db
      .select()
      .from(execNotifications)
      .where(eq(execNotifications.bookingId, booking.id));
    expect(rows.some((r) => r.kind === 'changed' && r.status === 'sent')).toBe(true);
  });

  it('fails cleanly when the booking has no driver', async () => {
    const booking = await seed(false);
    const res = await notifyExecOfChange({ db, notifications }, booking.id);
    expect(res).toMatchObject({ ok: false, reason: 'no_driver' });
  });

  it('fails cleanly for an unknown booking', async () => {
    const res = await notifyExecOfChange(
      { db, notifications },
      '00000000-0000-0000-0000-0000000000ff',
    );
    expect(res).toMatchObject({ ok: false, reason: 'booking_not_found' });
  });
});
