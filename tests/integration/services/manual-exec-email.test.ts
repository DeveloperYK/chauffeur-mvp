import { FakeEmailAdapter } from '@/server/adapters/email-fake';
import {
  type Booking,
  type Driver,
  auditEvents,
  bookings,
  drivers,
  operators,
} from '@/server/db/schema';
import {
  execEmailDraft,
  execEmailSendMap,
  listEmailAttentionBookings,
  sendManualExecEmail,
} from '@/server/services/exec-notifications';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SeedData } from '~test/fixtures/seed-data';
import { type TestDb, createTestDb } from '~test/helpers/pglite-db';

/**
 * Operator-triggered exec emails: the console drafts the confirmation and
 * driver-details emails, the operator edits and sends them explicitly. Nothing
 * is emailed automatically on assign / in-progress any more.
 */
describe('services/exec-notifications manual emails (integration)', () => {
  let db: TestDb;
  let close: () => Promise<void>;
  let operatorId: string;
  let driver: Driver;
  let emailer: FakeEmailAdapter;

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
    await db.delete(bookings);
    await db.delete(auditEvents);
    emailer = new FakeEmailAdapter();
  });

  async function seed(overrides: Record<string, unknown> = {}): Promise<Booking> {
    const [b] = await db
      .insert(bookings)
      .values({
        ...SeedData.bookings.unassigned(operatorId),
        execEmail: 'exec@example.com',
        ...overrides,
      })
      .returning();
    if (!b) throw new Error('seed failed');
    return b;
  }

  async function seedAssigned(): Promise<Booking> {
    const [b] = await db
      .insert(bookings)
      .values({
        ...SeedData.bookings.assigned(operatorId, driver.id),
        execEmail: 'exec@example.com',
      })
      .returning();
    if (!b) throw new Error('seed failed');
    return b;
  }

  // ── Drafts ─────────────────────────────────────────────────────

  it('drafts a confirmation email before any driver is assigned (no driver rows)', async () => {
    const booking = await seed();
    const result = await execEmailDraft(db, booking.id, 'assigned');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.to).toBe('exec@example.com');
    expect(result.draft.subject.toLowerCase()).toContain('confirmed');
    expect(result.draft.body).not.toContain('Driver:');
    expect(result.draft.body).toContain('Pickup:');
  });

  it('drafts the confirmation with driver details once a driver is assigned', async () => {
    const booking = await seedAssigned();
    const result = await execEmailDraft(db, booking.id, 'assigned');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.body).toContain(driver.name);
  });

  it('drafts the driver-details email for an assigned booking', async () => {
    const booking = await seedAssigned();
    const result = await execEmailDraft(db, booking.id, 'en_route');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.subject.toLowerCase()).toContain('driver details');
    expect(result.draft.body).toContain(driver.name);
  });

  it('refuses to draft the driver-details email with no driver on the job', async () => {
    const booking = await seed();
    const result = await execEmailDraft(db, booking.id, 'en_route');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no_driver');
  });

  it('drafts to an empty recipient when the booking has no exec email', async () => {
    const booking = await seed({ execEmail: null });
    const result = await execEmailDraft(db, booking.id, 'assigned');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.to).toBe('');
  });

  // ── Sending ────────────────────────────────────────────────────

  it('sends the operator-edited email and records the attempt', async () => {
    const booking = await seed();
    const result = await sendManualExecEmail(
      { db, email: emailer },
      {
        bookingId: booking.id,
        kind: 'assigned',
        to: 'pa@client.com',
        subject: 'Your booking is confirmed',
        body: 'Hello,\n\nAll confirmed for tomorrow.',
      },
      operatorId,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notification.to).toBe('pa@client.com');
    expect(result.notification.kind).toBe('assigned');
    expect(result.notification.channel).toBe('email');
    expect(result.notification.status).toBe('sent');
    // The provider got the branded HTML wrapping the edited text.
    expect(emailer.sent.length).toBe(1);
    expect(emailer.sent[0]?.to).toBe('pa@client.com');
    expect(emailer.sent[0]?.html).toContain('All confirmed for tomorrow.');
    expect(emailer.sent[0]?.html).toContain('JJ Chauffeuring Services (UK) Ltd');
    // The email carries the branded headline for its kind.
    expect(emailer.sent[0]?.html).toContain('Booking confirmed');
    // Audit trail names the actor and the send.
    const events = await db.select().from(auditEvents);
    const sent = events.find((e) => e.action === 'send_exec_email');
    expect(sent?.actorId).toBe(operatorId);
    expect((sent?.after as Record<string, unknown>)?.to).toBe('pa@client.com');
  });

  it('records a failed row when the provider rejects, and reports it', async () => {
    const booking = await seed();
    emailer.simulateFailure('provider_down');
    const result = await sendManualExecEmail(
      { db, email: emailer },
      {
        bookingId: booking.id,
        kind: 'assigned',
        to: 'exec@example.com',
        subject: 'S',
        body: 'B',
      },
      operatorId,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notification.status).toBe('failed');
    expect(result.notification.errorReason).toBe('provider_down');
  });

  it('rejects an invalid recipient address', async () => {
    const booking = await seed();
    const result = await sendManualExecEmail(
      { db, email: emailer },
      { bookingId: booking.id, kind: 'assigned', to: 'not-an-email', subject: 'S', body: 'B' },
      operatorId,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('validation');
    expect(emailer.sent.length).toBe(0);
  });

  it('rejects a blank subject or body', async () => {
    const booking = await seed();
    for (const args of [
      { subject: '', body: 'B' },
      { subject: 'S', body: '  ' },
    ]) {
      const result = await sendManualExecEmail(
        { db, email: emailer },
        { bookingId: booking.id, kind: 'assigned', to: 'a@b.com', ...args },
        operatorId,
      );
      expect(result.ok).toBe(false);
    }
  });

  it('refuses the driver-details email when no driver is on the job', async () => {
    const booking = await seed();
    const result = await sendManualExecEmail(
      { db, email: emailer },
      { bookingId: booking.id, kind: 'en_route', to: 'a@b.com', subject: 'S', body: 'B' },
      operatorId,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no_driver');
  });

  it('refuses to email about a cancelled booking', async () => {
    const booking = await seed({ state: 'cancelled' });
    const result = await sendManualExecEmail(
      { db, email: emailer },
      { bookingId: booking.id, kind: 'assigned', to: 'a@b.com', subject: 'S', body: 'B' },
      operatorId,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not_sendable');
  });

  // ── Send map (board flags) ─────────────────────────────────────

  it('maps which of the two emails each booking has had', async () => {
    const a = await seed();
    const b = await seedAssigned();
    await sendManualExecEmail(
      { db, email: emailer },
      { bookingId: b.id, kind: 'assigned', to: 'x@y.com', subject: 'S', body: 'B' },
      operatorId,
    );
    await sendManualExecEmail(
      { db, email: emailer },
      { bookingId: b.id, kind: 'en_route', to: 'x@y.com', subject: 'S', body: 'B' },
      operatorId,
    );
    const map = await execEmailSendMap(db, [a.id, b.id]);
    expect(map.get(a.id)?.confirmationSentAt ?? null).toBeNull();
    expect(map.get(b.id)?.confirmationSentAt).toBeTruthy();
    expect(map.get(b.id)?.driverDetailsSentAt).toBeTruthy();
  });

  it('a failed send does not count as sent in the map', async () => {
    const b = await seed();
    emailer.simulateFailure('down');
    await sendManualExecEmail(
      { db, email: emailer },
      { bookingId: b.id, kind: 'assigned', to: 'x@y.com', subject: 'S', body: 'B' },
      operatorId,
    );
    const map = await execEmailSendMap(db, [b.id]);
    expect(map.get(b.id)?.confirmationSentAt ?? null).toBeNull();
  });

  // ── "Emails due" saved view ────────────────────────────────────

  async function sendBoth(bookingId: string) {
    for (const kind of ['assigned', 'en_route'] as const) {
      const r = await sendManualExecEmail(
        { db, email: emailer },
        { bookingId, kind, to: 'x@y.com', subject: 'S', body: 'B' },
        operatorId,
      );
      if (!r.ok) throw new Error('send failed');
    }
  }

  it('lists a driver-assigned booking until both emails are sent', async () => {
    const b = await seedAssigned();
    let rows = await listEmailAttentionBookings(db);
    expect(rows.map((r) => r.id)).toContain(b.id);

    await sendBoth(b.id);
    rows = await listEmailAttentionBookings(db);
    expect(rows.map((r) => r.id)).not.toContain(b.id);
  });

  it('does not list a booking with no driver on the job yet', async () => {
    const b = await seed();
    const rows = await listEmailAttentionBookings(db);
    expect(rows.map((r) => r.id)).not.toContain(b.id);
  });

  it('lists any non-cancelled booking whose last exec message failed', async () => {
    const b = await seed({ state: 'completed' });
    emailer.simulateFailure('down');
    await sendManualExecEmail(
      { db, email: emailer },
      { bookingId: b.id, kind: 'assigned', to: 'x@y.com', subject: 'S', body: 'B' },
      operatorId,
    );
    const rows = await listEmailAttentionBookings(db);
    expect(rows.map((r) => r.id)).toContain(b.id);
  });

  it('never lists a cancelled booking, even with a failed message', async () => {
    const b = await seed({ state: 'cancelled', execNotificationStatus: 'failed' });
    const rows = await listEmailAttentionBookings(db);
    expect(rows.map((r) => r.id)).not.toContain(b.id);
  });

  it('does not list a quiet completed booking', async () => {
    const b = await seed({ state: 'completed' });
    const rows = await listEmailAttentionBookings(db);
    expect(rows.map((r) => r.id)).not.toContain(b.id);
  });

  // ── Booking update (kind `changed`) ────────────────────────────

  async function seedConfirmedChange(overrides: Record<string, unknown> = {}) {
    return seed({
      state: 'assigned',
      assignedDriverId: driver.id,
      changeConfirmationStatus: 'confirmed',
      changeExecRelevant: true,
      changeConfirmedAt: new Date('2026-05-18T10:00:00.000Z'),
      ...overrides,
    });
  }

  it('drafts the booking-update email from the current booking details', async () => {
    const b = await seedConfirmedChange();
    const result = await execEmailDraft(db, b.id, 'changed');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.subject.toLowerCase()).toContain('update');
    expect(result.draft.body).toContain('Reference:');
  });

  it('sends the booking-update email and records a `changed` attempt', async () => {
    const b = await seedConfirmedChange();
    const result = await sendManualExecEmail(
      { db, email: emailer },
      { bookingId: b.id, kind: 'changed', to: 'x@y.com', subject: 'S', body: 'B' },
      operatorId,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notification.kind).toBe('changed');
    expect(emailer.sent[0]?.html).toContain('Booking update confirmed');
  });

  it('flags a confirmed exec-relevant change in the attention view until the update is sent', async () => {
    const b = await seedConfirmedChange();
    let rows = await listEmailAttentionBookings(db);
    expect(rows.map((r) => r.id)).toContain(b.id);

    const sent = await sendManualExecEmail(
      { db, email: emailer },
      { bookingId: b.id, kind: 'changed', to: 'x@y.com', subject: 'S', body: 'B' },
      operatorId,
    );
    expect(sent.ok).toBe(true);
    // The confirmation/driver-details emails may still be due on this booking —
    // check the change-update flag specifically via the send map.
    const map = await execEmailSendMap(db, [b.id]);
    expect(map.get(b.id)?.changeUpdateSentAt).toBeTruthy();

    await sendBoth(b.id);
    rows = await listEmailAttentionBookings(db);
    expect(rows.map((r) => r.id)).not.toContain(b.id);
  });

  it('re-flags when a later change is confirmed after the last update email', async () => {
    const b = await seedConfirmedChange();
    await sendBoth(b.id);
    await sendManualExecEmail(
      { db, email: emailer },
      { bookingId: b.id, kind: 'changed', to: 'x@y.com', subject: 'S', body: 'B' },
      operatorId,
    );
    let rows = await listEmailAttentionBookings(db);
    expect(rows.map((r) => r.id)).not.toContain(b.id);

    // A newer change gets confirmed AFTER that update email went out.
    await db
      .update(bookings)
      .set({ changeConfirmedAt: new Date(Date.now() + 60_000) })
      .where(eq(bookings.id, b.id));
    rows = await listEmailAttentionBookings(db);
    expect(rows.map((r) => r.id)).toContain(b.id);
  });

  it('a pending (unconfirmed) change is not update-flagged yet', async () => {
    const b = await seedConfirmedChange({
      changeConfirmationStatus: 'pending',
      changeConfirmedAt: null,
    });
    await sendBoth(b.id);
    const rows = await listEmailAttentionBookings(db);
    expect(rows.map((r) => r.id)).not.toContain(b.id);
  });
});
