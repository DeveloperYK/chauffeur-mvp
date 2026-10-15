import { FakeEmailAdapter } from '@/server/adapters/email-fake';
import {
  type Booking,
  type Driver,
  auditEvents,
  bookings,
  drivers,
  operators,
} from '@/server/db/schema';
import { countActionViews, listActionView } from '@/server/services/action-views';
import { waiveExecEmail } from '@/server/services/exec-email-waiver';
import {
  listEmailAttentionBookings,
  sendManualExecEmail,
} from '@/server/services/exec-notifications';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SeedData } from '~test/fixtures/seed-data';
import { type TestDb, createTestDb } from '~test/helpers/pglite-db';

/**
 * "Mark as handled": the operator told the exec another way (phone, their own
 * mailbox) or the email is no longer worth sending. Waiving a due email clears
 * it from the "Send exec emails" view, the tile tag and the panel flag without
 * pretending an email was sent. Reversible, audited.
 */
describe('services/exec-email-waiver (integration)', () => {
  let db: TestDb;
  let close: () => Promise<void>;
  let operatorId: string;
  let driver: Driver;
  const NOW = new Date('2026-05-20T09:00:00Z');

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
  });

  async function seedAssigned(overrides: Record<string, unknown> = {}): Promise<Booking> {
    const [b] = await db
      .insert(bookings)
      .values({
        ...SeedData.bookings.assigned(operatorId, driver.id),
        execEmail: 'exec@example.com',
        ...overrides,
      })
      .returning();
    if (!b) throw new Error('seed failed');
    return b;
  }

  const attentionIds = async () => (await listEmailAttentionBookings(db)).map((b) => b.id);
  const reload = async (id: string) =>
    (await db.select().from(bookings).where(eq(bookings.id, id)))[0] as Booking;

  // ── Happy paths ────────────────────────────────────────────────

  it('waiving the confirmation stamps it and leaves the driver-details email due', async () => {
    const b = await seedAssigned();
    const r = await waiveExecEmail(
      db,
      { bookingId: b.id, kind: 'assigned', waived: true },
      operatorId,
    );
    expect(r.ok).toBe(true);
    const row = await reload(b.id);
    expect(row.confirmationEmailWaivedAt).toBeInstanceOf(Date);
    expect(row.driverDetailsEmailWaivedAt).toBeNull();
    expect(await attentionIds()).toContain(b.id);
  });

  it('waiving both emails removes the booking from the "Send exec emails" view and its count', async () => {
    const b = await seedAssigned();
    await waiveExecEmail(db, { bookingId: b.id, kind: 'assigned', waived: true }, operatorId);
    await waiveExecEmail(db, { bookingId: b.id, kind: 'en_route', waived: true }, operatorId);
    expect(await attentionIds()).not.toContain(b.id);
    expect((await listActionView(db, 'send_emails', NOW)).map((x) => x.id)).not.toContain(b.id);
    expect((await countActionViews(db, NOW)).send_emails).toEqual({ total: 0, urgent: 0 });
  });

  it('a waived email plus a sent email also clears the view', async () => {
    const b = await seedAssigned();
    await waiveExecEmail(db, { bookingId: b.id, kind: 'assigned', waived: true }, operatorId);
    const sent = await sendManualExecEmail(
      { db, email: new FakeEmailAdapter() },
      {
        bookingId: b.id,
        kind: 'en_route',
        to: 'x@y.com',
        subject: 'S',
        intro: 'B',
        rows: [],
        closing: '',
      },
      operatorId,
    );
    expect(sent.ok).toBe(true);
    expect(await attentionIds()).not.toContain(b.id);
  });

  it('undoing a waiver puts the booking back in the view', async () => {
    const b = await seedAssigned();
    await waiveExecEmail(db, { bookingId: b.id, kind: 'assigned', waived: true }, operatorId);
    await waiveExecEmail(db, { bookingId: b.id, kind: 'en_route', waived: true }, operatorId);
    expect(await attentionIds()).not.toContain(b.id);
    const r = await waiveExecEmail(
      db,
      { bookingId: b.id, kind: 'en_route', waived: false },
      operatorId,
    );
    expect(r.ok).toBe(true);
    expect((await reload(b.id)).driverDetailsEmailWaivedAt).toBeNull();
    expect(await attentionIds()).toContain(b.id);
  });

  it('waiving the booking-update email clears a confirmed change; a later change re-flags it', async () => {
    const confirmedAt = new Date('2026-05-19T10:00:00Z');
    const b = await seedAssigned({
      changeConfirmationStatus: 'confirmed',
      changeExecRelevant: true,
      changeConfirmedAt: confirmedAt,
      // both routine emails already waived so only the update keeps it listed
      confirmationEmailWaivedAt: confirmedAt,
      driverDetailsEmailWaivedAt: confirmedAt,
    });
    expect(await attentionIds()).toContain(b.id);
    await waiveExecEmail(db, { bookingId: b.id, kind: 'changed', waived: true }, operatorId);
    expect(await attentionIds()).not.toContain(b.id);

    // A newer confirmed change outranks the old waiver.
    await db
      .update(bookings)
      .set({ changeConfirmedAt: new Date(Date.now() + 60_000) })
      .where(eq(bookings.id, b.id));
    expect(await attentionIds()).toContain(b.id);
  });

  it('records an audit row for the waiver and for the undo', async () => {
    const b = await seedAssigned();
    await waiveExecEmail(db, { bookingId: b.id, kind: 'assigned', waived: true }, operatorId);
    await waiveExecEmail(db, { bookingId: b.id, kind: 'assigned', waived: false }, operatorId);
    const rows = await db.select().from(auditEvents).where(eq(auditEvents.entityId, b.id));
    expect(rows.map((r) => r.action)).toEqual(['waive_exec_email', 'unwaive_exec_email']);
    expect(rows[0]?.actorId).toBe(operatorId);
    expect(rows[0]?.after).toMatchObject({ kind: 'assigned' });
  });

  // ── Unhappy paths ──────────────────────────────────────────────

  it('rejects an unknown booking', async () => {
    const r = await waiveExecEmail(
      db,
      { bookingId: '00000000-0000-4000-8000-000000000000', kind: 'assigned', waived: true },
      operatorId,
    );
    expect(r).toEqual({ ok: false, reason: 'booking_not_found' });
  });

  it('rejects malformed input (bad kind, non-uuid id, extra field)', async () => {
    const b = await seedAssigned();
    for (const raw of [
      { bookingId: b.id, kind: 'nope', waived: true },
      { bookingId: 'not-a-uuid', kind: 'assigned', waived: true },
      { bookingId: b.id, kind: 'assigned', waived: true, extra: 1 },
    ]) {
      const r = await waiveExecEmail(db, raw, operatorId);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('validation');
    }
    expect((await reload(b.id)).confirmationEmailWaivedAt).toBeNull();
  });

  it('a waiver never hides a failed delivery — that still needs a resend', async () => {
    const b = await seedAssigned({ execNotificationStatus: 'failed' });
    await waiveExecEmail(db, { bookingId: b.id, kind: 'assigned', waived: true }, operatorId);
    await waiveExecEmail(db, { bookingId: b.id, kind: 'en_route', waived: true }, operatorId);
    expect(await attentionIds()).toContain(b.id);
  });

  it('waiving is idempotent: a second waive keeps the first timestamp', async () => {
    const b = await seedAssigned();
    await waiveExecEmail(db, { bookingId: b.id, kind: 'assigned', waived: true }, operatorId);
    const first = (await reload(b.id)).confirmationEmailWaivedAt;
    await waiveExecEmail(db, { bookingId: b.id, kind: 'assigned', waived: true }, operatorId);
    expect((await reload(b.id)).confirmationEmailWaivedAt).toEqual(first);
  });
});
