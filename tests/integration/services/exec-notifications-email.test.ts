import { FakeEmailAdapter } from '@/server/adapters/email-fake';
import { FakeNotificationAdapter } from '@/server/adapters/notification-fake';
import {
  type Booking,
  type Driver,
  bookings,
  drivers,
  execNotifications,
  operators,
} from '@/server/db/schema';
import {
  type ExecNotificationDeps,
  listExecNotifications,
  resendExecNotification,
  sendExecNotification,
} from '@/server/services/exec-notifications';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SeedData } from '~test/fixtures/seed-data';
import { type TestDb, createTestDb } from '~test/helpers/pglite-db';

// Exercises the email branch of the wrapper. The active channel is a code
// constant (EXEC_NOTIFICATION_CHANNEL = 'sms'); these tests use the `channel`
// override on the deps to drive the email path without mocking the constant.
describe('services/exec-notifications email channel (integration)', () => {
  let db: TestDb;
  let close: () => Promise<void>;
  let operatorId: string;
  let driver: Driver;
  let notifications: FakeNotificationAdapter;
  let emailer: FakeEmailAdapter;

  const emailDeps = (): ExecNotificationDeps => ({
    db,
    notifications,
    email: emailer,
    channel: 'email',
  });

  async function seedAssigned(execEmail: string | null): Promise<Booking> {
    const [b] = await db
      .insert(bookings)
      .values({ ...SeedData.bookings.assigned(operatorId, driver.id), execEmail })
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

  function ctxFor(booking: Booking) {
    return {
      booking,
      kind: 'assigned' as const,
      driverName: driver.name,
      car: 'Black Mercedes S-Class',
    };
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
    await db.delete(bookings);
    notifications = new FakeNotificationAdapter();
    emailer = new FakeEmailAdapter();
  });

  it('sends via email and records a pending booking (accepted, not yet delivered)', async () => {
    const booking = await seedAssigned('exec@example.com');
    const row = await sendExecNotification(emailDeps(), ctxFor(booking));

    expect(row?.channel).toBe('email');
    expect(row?.status).toBe('sent');
    expect(row?.to).toBe('exec@example.com');
    expect(row?.subject).toBeTruthy();
    expect(row?.providerMessageId).toBeTruthy();
    // No SMS went out; one email did.
    expect(notifications.sent.length).toBe(0);
    expect(emailer.sent.length).toBe(1);
    expect(emailer.sent[0]?.to).toBe('exec@example.com');
    // Email accepted ⇒ booking is pending until a delivery webhook (V3).
    expect(await status(booking.id)).toBe('pending');
  });

  it('records a failed row + failed booking when the provider rejects', async () => {
    const booking = await seedAssigned('exec@example.com');
    emailer.simulateFailure('http_422');
    const row = await sendExecNotification(emailDeps(), ctxFor(booking));

    expect(row?.status).toBe('failed');
    expect(row?.errorReason).toBe('http_422');
    expect(await status(booking.id)).toBe('failed');
  });

  it('no-contact guard: email mode with no exec_email is a loud failure, no send', async () => {
    const booking = await seedAssigned(null);
    const row = await sendExecNotification(emailDeps(), ctxFor(booking));

    expect(row?.status).toBe('failed');
    expect(row?.errorReason).toBe('no_email');
    expect(row?.channel).toBe('email');
    expect(emailer.sent.length).toBe(0); // never called the provider
    expect(await status(booking.id)).toBe('failed');
  });

  it('flags email_not_configured when email is the channel but no adapter is wired', async () => {
    const booking = await seedAssigned('exec@example.com');
    const row = await sendExecNotification(
      { db, notifications, channel: 'email' },
      ctxFor(booking),
    );
    expect(row?.status).toBe('failed');
    expect(row?.errorReason).toBe('email_not_configured');
  });

  it('resend on the email channel supersedes the old row and clears to pending', async () => {
    const booking = await seedAssigned('exec@example.com');
    emailer.simulateFailure('http_500');
    const failed = await sendExecNotification(emailDeps(), ctxFor(booking));
    expect(await status(booking.id)).toBe('failed');

    emailer.simulateFailure(null);
    const result = await resendExecNotification(emailDeps(), failed?.id ?? '');
    expect(result.ok).toBe(true);
    expect(await status(booking.id)).toBe('pending');

    const rows = await listExecNotifications(db, booking.id);
    expect(rows.length).toBe(2);
    expect(rows.find((r) => r.id === failed?.id)?.status).toBe('superseded');
    expect(rows.some((r) => r.status === 'sent' && r.channel === 'email')).toBe(true);
  });
});
