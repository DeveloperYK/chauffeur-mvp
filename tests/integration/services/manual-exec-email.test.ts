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
    const labels = result.draft.rows.map((r) => r.label);
    expect(labels).not.toContain('Driver');
    expect(labels).toContain('Pickup');
    expect(result.draft.heading).toBe('Booking confirmed');
    expect(result.draft.intro).toContain('confirmed');
    expect(result.draft.closing).toContain('contact our team');
  });

  it('drafts the same driver-free confirmation once a driver is assigned (driver goes in email 2)', async () => {
    const booking = await seedAssigned();
    const confirmation = await execEmailDraft(db, booking.id, 'assigned');
    const details = await execEmailDraft(db, booking.id, 'en_route');
    expect(confirmation.ok && details.ok).toBe(true);
    if (!confirmation.ok || !details.ok) return;
    expect(confirmation.draft.rows.map((r) => r.label)).not.toContain('Driver');
    expect(details.draft.rows).toContainEqual({ label: 'Driver', value: driver.name });
    expect(confirmation.draft.rows).not.toEqual(details.draft.rows);
  });

  it('drafts the driver-details email for an assigned booking', async () => {
    const booking = await seedAssigned();
    const result = await execEmailDraft(db, booking.id, 'en_route');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.subject.toLowerCase()).toContain('driver details');
    expect(result.draft.rows).toContainEqual({ label: 'Driver', value: driver.name });
    expect(result.draft.heading).toBe('Your driver details');
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

  const EMPTY_PARTS = { intro: '', rows: [], closing: '' };

  describe('recipients', () => {
    const withPa = { bookedByName: 'Jane PA', bookedByEmail: 'pa@client.com' };

    it('addresses the confirmation to the PA when one is on file, offering the exec as a copy', async () => {
      const booking = await seed(withPa);
      const result = await execEmailDraft(db, booking.id, 'assigned');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.draft.to).toBe('pa@client.com');
      expect(result.draft.cc).toEqual([]);
      expect(result.draft.copyTo).toEqual({ role: 'exec', email: 'exec@example.com' });
    });

    it('addresses the confirmation to the exec when no PA email is on file', async () => {
      const booking = await seed({ bookedByName: 'Jane PA', bookedByPhone: '+447700900123' });
      const result = await execEmailDraft(db, booking.id, 'assigned');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.draft.to).toBe('exec@example.com');
      expect(result.draft.copyTo).toBeNull();
    });

    it('addresses the driver details to the exec, copying the PA by default', async () => {
      const [b] = await db
        .insert(bookings)
        .values({
          ...SeedData.bookings.assigned(operatorId, driver.id),
          execEmail: 'exec@example.com',
          ...withPa,
        })
        .returning();
      if (!b) throw new Error('seed failed');
      const result = await execEmailDraft(db, b.id, 'en_route');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.draft.to).toBe('exec@example.com');
      expect(result.draft.cc).toEqual(['pa@client.com']);
      expect(result.draft.copyTo).toEqual({ role: 'pa', email: 'pa@client.com' });
    });

    it('addresses the booking update like the confirmation (PA first)', async () => {
      const booking = await seed(withPa);
      const result = await execEmailDraft(db, booking.id, 'changed');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.draft.to).toBe('pa@client.com');
      expect(result.draft.copyTo).toEqual({ role: 'exec', email: 'exec@example.com' });
    });

    it('falls back to the PA when the booking has no exec email at all', async () => {
      const booking = await seed({ execEmail: null, ...withPa });
      const details = await execEmailDraft(db, booking.id, 'assigned');
      expect(details.ok).toBe(true);
      if (!details.ok) return;
      expect(details.draft.to).toBe('pa@client.com');
      expect(details.draft.copyTo).toBeNull();
    });

    it('never offers a copy to the same address as the To', async () => {
      const booking = await seed({ bookedByName: 'Self', bookedByEmail: 'exec@example.com' });
      const result = await execEmailDraft(db, booking.id, 'assigned');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.draft.to).toBe('exec@example.com');
      expect(result.draft.copyTo).toBeNull();
    });
  });

  describe('cc on send', () => {
    const parts = { subject: 'S', intro: 'Hello', rows: [], closing: '' };

    it('sends the CC list to the provider, stores it on the row and in the audit trail', async () => {
      const booking = await seed();
      const result = await sendManualExecEmail(
        { db, email: emailer },
        {
          bookingId: booking.id,
          kind: 'assigned',
          to: 'pa@client.com',
          cc: ['exec@example.com', 'office@client.com'],
          ...parts,
        },
        operatorId,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(emailer.sent[0]?.cc).toEqual(['exec@example.com', 'office@client.com']);
      expect(result.notification.cc).toEqual(['exec@example.com', 'office@client.com']);
      const events = await db.select().from(auditEvents);
      const sent = events.find((e) => e.action === 'send_exec_email');
      expect((sent?.after as Record<string, unknown>)?.cc).toEqual([
        'exec@example.com',
        'office@client.com',
      ]);
    });

    it('sends with no CC when the list is omitted or empty', async () => {
      const booking = await seed();
      const omitted = await sendManualExecEmail(
        { db, email: emailer },
        { bookingId: booking.id, kind: 'assigned', to: 'pa@client.com', ...parts },
        operatorId,
      );
      const empty = await sendManualExecEmail(
        { db, email: emailer },
        { bookingId: booking.id, kind: 'assigned', to: 'pa@client.com', cc: [], ...parts },
        operatorId,
      );
      expect(omitted.ok && empty.ok).toBe(true);
      if (!omitted.ok || !empty.ok) return;
      expect(omitted.notification.cc).toEqual([]);
      expect(empty.notification.cc).toEqual([]);
      expect(emailer.sent[0]?.cc).toBeUndefined();
    });

    it('dedupes the CC list and drops the To address from it', async () => {
      const booking = await seed();
      const result = await sendManualExecEmail(
        { db, email: emailer },
        {
          bookingId: booking.id,
          kind: 'assigned',
          to: 'pa@client.com',
          cc: ['Exec@Example.com', 'exec@example.com', 'PA@client.com'],
          ...parts,
        },
        operatorId,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.notification.cc).toEqual(['exec@example.com']);
      expect(emailer.sent[0]?.cc).toEqual(['exec@example.com']);
    });

    it('rejects an invalid CC address with a message naming it', async () => {
      const booking = await seed();
      const result = await sendManualExecEmail(
        { db, email: emailer },
        { bookingId: booking.id, kind: 'assigned', to: 'pa@client.com', cc: ['nope'], ...parts },
        operatorId,
      );
      expect(result.ok).toBe(false);
      if (result.ok || result.reason !== 'validation') throw new Error('expected validation');
      expect(result.issues[0]?.message).toContain('CC');
      expect(emailer.sent.length).toBe(0);
    });

    it('rejects more than 5 CC addresses', async () => {
      const booking = await seed();
      const cc = Array.from({ length: 6 }, (_, i) => `cc${i}@client.com`);
      const result = await sendManualExecEmail(
        { db, email: emailer },
        { bookingId: booking.id, kind: 'assigned', to: 'pa@client.com', cc, ...parts },
        operatorId,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('validation');
    });
  });

  it('renders an added detail row as a table row in the HTML and a line in the stored text', async () => {
    const booking = await seedAssigned();
    const draft = await execEmailDraft(db, booking.id, 'en_route');
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    const result = await sendManualExecEmail(
      { db, email: emailer },
      {
        bookingId: booking.id,
        kind: 'en_route',
        to: 'pa@client.com',
        subject: draft.draft.subject,
        intro: draft.draft.intro,
        rows: [...draft.draft.rows, { label: 'Flight', value: 'BA123' }],
        closing: draft.draft.closing,
      },
      operatorId,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const html = emailer.sent[0]?.html ?? '';
    expect(html.match(/<tr>/g)?.length).toBe(draft.draft.rows.length + 1);
    expect(html).toContain('>Flight</td>');
    expect(html).toContain('>Driver</td>');
    expect(result.notification.body).toMatch(/Flight\s+BA123/);
    expect(result.notification.body).toContain(driver.name);
  });

  it('rejects a detail row with an empty label or value, or an over-long label', async () => {
    const booking = await seed();
    for (const rows of [
      [{ label: '', value: 'BA123' }],
      [{ label: 'Flight', value: '  ' }],
      [{ label: 'x'.repeat(41), value: 'BA123' }],
    ]) {
      const result = await sendManualExecEmail(
        { db, email: emailer },
        {
          bookingId: booking.id,
          kind: 'assigned',
          to: 'a@b.com',
          subject: 'S',
          ...EMPTY_PARTS,
          rows,
        },
        operatorId,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('validation');
    }
    expect(emailer.sent.length).toBe(0);
  });

  it('rejects more than 30 detail rows', async () => {
    const booking = await seed();
    const rows = Array.from({ length: 31 }, (_, i) => ({ label: `L${i}`, value: `v${i}` }));
    const result = await sendManualExecEmail(
      { db, email: emailer },
      {
        bookingId: booking.id,
        kind: 'assigned',
        to: 'a@b.com',
        subject: 'S',
        ...EMPTY_PARTS,
        rows,
      },
      operatorId,
    );
    expect(result.ok).toBe(false);
  });

  it('rejects the legacy free-text body field (strict schema)', async () => {
    const booking = await seed();
    const result = await sendManualExecEmail(
      { db, email: emailer },
      { bookingId: booking.id, kind: 'assigned', to: 'a@b.com', subject: 'S', body: 'Hello' },
      operatorId,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('validation');
  });

  it('sends the operator-edited email and records the attempt', async () => {
    const booking = await seed();
    const result = await sendManualExecEmail(
      { db, email: emailer },
      {
        bookingId: booking.id,
        kind: 'assigned',
        to: 'pa@client.com',
        subject: 'Your booking is confirmed',
        intro: 'Hello,\n\nAll confirmed for tomorrow.',
        rows: [],
        closing: '',
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
        intro: 'B',
        rows: [],
        closing: '',
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
      {
        bookingId: booking.id,
        kind: 'assigned',
        to: 'not-an-email',
        subject: 'S',
        ...EMPTY_PARTS,
        intro: 'B',
      },
      operatorId,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('validation');
    expect(emailer.sent.length).toBe(0);
  });

  it('rejects a blank subject, or an email with no intro, rows or closing', async () => {
    const booking = await seed();
    for (const args of [
      { subject: '', ...EMPTY_PARTS, intro: 'B' },
      { subject: 'S', ...EMPTY_PARTS, intro: '  ' },
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
      {
        bookingId: booking.id,
        kind: 'en_route',
        to: 'a@b.com',
        subject: 'S',
        ...EMPTY_PARTS,
        intro: 'B',
      },
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
      {
        bookingId: booking.id,
        kind: 'assigned',
        to: 'a@b.com',
        subject: 'S',
        ...EMPTY_PARTS,
        intro: 'B',
      },
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
      {
        bookingId: b.id,
        kind: 'assigned',
        to: 'x@y.com',
        subject: 'S',
        ...EMPTY_PARTS,
        intro: 'B',
      },
      operatorId,
    );
    await sendManualExecEmail(
      { db, email: emailer },
      {
        bookingId: b.id,
        kind: 'en_route',
        to: 'x@y.com',
        subject: 'S',
        ...EMPTY_PARTS,
        intro: 'B',
      },
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
      {
        bookingId: b.id,
        kind: 'assigned',
        to: 'x@y.com',
        subject: 'S',
        ...EMPTY_PARTS,
        intro: 'B',
      },
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
        { bookingId, kind, to: 'x@y.com', subject: 'S', ...EMPTY_PARTS, intro: 'B' },
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
      {
        bookingId: b.id,
        kind: 'assigned',
        to: 'x@y.com',
        subject: 'S',
        ...EMPTY_PARTS,
        intro: 'B',
      },
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
    expect(result.draft.rows.map((r) => r.label)).toContain('Reference');
    expect(result.draft.heading).toBe('Booking update confirmed');
  });

  it('sends the booking-update email and records a `changed` attempt', async () => {
    const b = await seedConfirmedChange();
    const result = await sendManualExecEmail(
      { db, email: emailer },
      { bookingId: b.id, kind: 'changed', to: 'x@y.com', subject: 'S', ...EMPTY_PARTS, intro: 'B' },
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
      { bookingId: b.id, kind: 'changed', to: 'x@y.com', subject: 'S', ...EMPTY_PARTS, intro: 'B' },
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
      { bookingId: b.id, kind: 'changed', to: 'x@y.com', subject: 'S', ...EMPTY_PARTS, intro: 'B' },
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

describe('sendManualExecEmail — operator sign-off', () => {
  let db: TestDb;
  let close: () => Promise<void>;
  let operatorId: string;
  let emailer: FakeEmailAdapter;

  beforeAll(async () => {
    const t = await createTestDb();
    db = t.db;
    close = t.close;
    const [op] = await db
      .insert(operators)
      .values({ email: 'alice@example.com', passwordHash: 'x', name: 'Alice Okafor' })
      .returning();
    operatorId = op?.id ?? '';
  });

  afterAll(async () => {
    await close();
  });

  beforeEach(async () => {
    await db.delete(bookings);
    emailer = new FakeEmailAdapter();
  });

  async function seedBooking(): Promise<Booking> {
    const [b] = await db
      .insert(bookings)
      .values({
        ...SeedData.bookings.unassigned(operatorId),
        execEmail: 'exec@client.com',
      })
      .returning();
    if (!b) throw new Error('seed failed');
    return b;
  }

  async function sendConfirmation(opId: string) {
    const booking = await seedBooking();
    const draft = await execEmailDraft(db, booking.id, 'assigned');
    if (!draft.ok) throw new Error('draft failed');
    return sendManualExecEmail(
      { db, email: emailer },
      {
        bookingId: booking.id,
        kind: 'assigned',
        to: 'exec@client.com',
        subject: draft.draft.subject,
        intro: draft.draft.intro,
        rows: draft.draft.rows,
        closing: draft.draft.closing,
      },
      opId,
    );
  }

  it('signs the sent email and the stored body off with the sending operator', async () => {
    const result = await sendConfirmation(operatorId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(emailer.sent[0]?.html).toContain('Kind regards,');
    expect(emailer.sent[0]?.html).toContain('Alice Okafor');
    expect(emailer.sent[0]?.text).toContain('Kind regards,\nAlice Okafor');
    expect(result.notification.body).toContain('Kind regards,\nAlice Okafor');
  });

  it('still sends, without a sign-off, when the operator cannot be found', async () => {
    const result = await sendConfirmation('00000000-0000-0000-0000-000000000000');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(emailer.sent[0]?.text).not.toContain('Kind regards');
  });
});
