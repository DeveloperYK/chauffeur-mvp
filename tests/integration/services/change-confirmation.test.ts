import { FakeEmailAdapter } from '@/server/adapters/email-fake';
import { FakeNotificationAdapter } from '@/server/adapters/notification-fake';
import { FakeSpreadsheetMirror } from '@/server/adapters/spreadsheet-mirror-fake';
import { auditEvents, bookings, drivers, execNotifications, operators } from '@/server/db/schema';
import {
  confirmChangeBySelf,
  confirmChangeOnBehalf,
  generateChangeConfirmLink,
  previewChangeConfirmLink,
} from '@/server/services/change-confirmation';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestDb, createTestDb } from '~test/helpers/pglite-db';

const SECRET = 'test-secret-test-secret-test-secret-0123456789';
const APP_URL = 'https://dispatch.example.com';

describe('services/change-confirmation (integration)', () => {
  let db: TestDb;
  let close: () => Promise<void>;
  let operatorId: string;
  let driverId: string;
  let mirror: FakeSpreadsheetMirror;

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
        name: 'Tom Premium',
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
    await db.delete(bookings);
    await db.delete(auditEvents);
    mirror = new FakeSpreadsheetMirror();
  });

  async function seed(opts: {
    status?: 'none' | 'pending' | 'confirmed';
    assigned?: boolean;
    backfill?: boolean;
    execRelevant?: boolean;
    execEmail?: string | null;
  }) {
    const [row] = await db
      .insert(bookings)
      .values({
        state: opts.backfill || opts.assigned ? 'assigned' : 'unassigned',
        // Far-future pickup so the minted link's expiry (pickup + 2d) is always
        // ahead of the real clock used by signDriverLink/verifyDriverLink.
        pickupAt: new Date('2099-06-01T10:00:00.000Z'),
        expectedDurationMinutes: 90,
        pickupAddress: '11 Belsize Park Gardens, London',
        dropoffAddress: 'LHR Terminal 5',
        passengerFirstName: 'Eric',
        passengerLastName: 'French',
        execMobile: '+447911123456',
        execEmail: opts.execEmail ?? null,
        clientName: 'LEGO Group',
        accountCode: 'LEGO Group',
        contractPricePence: 30000,
        createdByOperatorId: operatorId,
        assignedOperatorId: operatorId,
        assignedDriverId: opts.backfill ? null : opts.assigned ? driverId : null,
        isBackfill: opts.backfill ?? false,
        backfillDriverName: opts.backfill ? 'Sub Sam' : null,
        backfillDriverPhone: opts.backfill ? '+447900000777' : null,
        changeConfirmationStatus: opts.status ?? 'none',
        changeExecRelevant: opts.execRelevant ?? false,
        changePendingSince: opts.status === 'pending' ? new Date() : null,
      })
      .returning();
    if (!row) throw new Error('seed failed');
    return row;
  }

  const tokenFromUrl = (url: string): string => url.split('/j/')[1] ?? '';

  // ── generateChangeConfirmLink ─────────────────────────────────────────────
  describe('generateChangeConfirmLink', () => {
    it('mints a link + WhatsApp deep link for the assigned driver on a pending change', async () => {
      const booking = await seed({ status: 'pending', assigned: true });
      const res = await generateChangeConfirmLink(booking.id, operatorId, {
        db,
        secret: SECRET,
        appUrl: APP_URL,
      });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.url).toContain(`${APP_URL}/j/`);
      expect(res.shortUrl).toContain(`${APP_URL}/s/`);
      expect(res.whatsappUrl).toContain('web.whatsapp.com');
      expect(res.driver.id).toBe(driverId);

      const audits = await db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.entityId, booking.id));
      expect(audits.some((a) => a.action === 'change_link_generated')).toBe(true);
    });

    it('rejects when there is no pending change', async () => {
      const booking = await seed({ status: 'none', assigned: true });
      const res = await generateChangeConfirmLink(booking.id, operatorId, {
        db,
        secret: SECRET,
        appUrl: APP_URL,
      });
      expect(res).toEqual({ ok: false, reason: 'no_pending_change' });
    });

    it('rejects a backfill job (no app driver) — operator must attest', async () => {
      const booking = await seed({ status: 'pending', backfill: true });
      const res = await generateChangeConfirmLink(booking.id, operatorId, {
        db,
        secret: SECRET,
        appUrl: APP_URL,
      });
      expect(res).toEqual({ ok: false, reason: 'no_app_driver' });
    });

    it('rejects an unknown booking', async () => {
      const res = await generateChangeConfirmLink(
        '00000000-0000-0000-0000-0000000000ff',
        operatorId,
        {
          db,
          secret: SECRET,
          appUrl: APP_URL,
        },
      );
      expect(res).toEqual({ ok: false, reason: 'booking_not_found' });
    });
  });

  // ── confirmChangeOnBehalf (operator attests) ──────────────────────────────
  describe('confirmChangeOnBehalf', () => {
    it('confirms a pending change as operator_attested and mirrors', async () => {
      const booking = await seed({ status: 'pending', assigned: true });
      const res = await confirmChangeOnBehalf(booking.id, operatorId, { db, mirror });
      expect(res.ok).toBe(true);

      const [row] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
      expect(row?.changeConfirmationStatus).toBe('confirmed');
      expect(row?.changeConfirmedMethod).toBe('operator_attested');
      expect(row?.changeConfirmedByOperatorId).toBe(operatorId);
      expect(row?.changeConfirmedAt).toBeTruthy();
      expect(mirror.rows.has(booking.id)).toBe(true);

      const audits = await db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.entityId, booking.id));
      expect(audits.some((a) => a.action === 'change_confirmed')).toBe(true);
    });

    it('rejects an unknown booking', async () => {
      const res = await confirmChangeOnBehalf('00000000-0000-0000-0000-0000000000ff', operatorId, {
        db,
        mirror,
      });
      expect(res).toEqual({ ok: false, reason: 'booking_not_found' });
    });

    it('rejects when there is no pending change', async () => {
      const booking = await seed({ status: 'none', assigned: true });
      const res = await confirmChangeOnBehalf(booking.id, operatorId, { db, mirror });
      expect(res).toEqual({ ok: false, reason: 'no_pending_change' });
    });

    it('is idempotent — a second attest is a no-op', async () => {
      const booking = await seed({ status: 'pending', assigned: true });
      const first = await confirmChangeOnBehalf(booking.id, operatorId, { db, mirror });
      expect(first.ok).toBe(true);
      const second = await confirmChangeOnBehalf(booking.id, operatorId, { db, mirror });
      expect(second).toEqual({ ok: false, reason: 'no_pending_change' });
    });
  });

  // ── confirmChangeBySelf (driver taps link) ────────────────────────────────
  describe('confirmChangeBySelf', () => {
    it('confirms a pending change as driver_self via a valid token', async () => {
      const booking = await seed({ status: 'pending', assigned: true });
      const link = await generateChangeConfirmLink(booking.id, operatorId, {
        db,
        secret: SECRET,
        appUrl: APP_URL,
      });
      expect(link.ok).toBe(true);
      if (!link.ok) return;

      const res = await confirmChangeBySelf(tokenFromUrl(link.url), { db, secret: SECRET, mirror });
      expect(res.ok).toBe(true);

      const [row] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
      expect(row?.changeConfirmationStatus).toBe('confirmed');
      expect(row?.changeConfirmedMethod).toBe('driver_self');
      expect(row?.changeConfirmedByOperatorId).toBeNull();
    });

    it('rejects a malformed token', async () => {
      const res = await confirmChangeBySelf('not-a-jwt', { db, secret: SECRET, mirror });
      expect(res).toEqual({ ok: false, reason: 'token_invalid' });
    });

    it('rejects re-tapping after the change is already confirmed', async () => {
      const booking = await seed({ status: 'pending', assigned: true });
      const link = await generateChangeConfirmLink(booking.id, operatorId, {
        db,
        secret: SECRET,
        appUrl: APP_URL,
      });
      if (!link.ok) throw new Error('mint failed');
      const token = tokenFromUrl(link.url);
      const first = await confirmChangeBySelf(token, { db, secret: SECRET, mirror });
      expect(first.ok).toBe(true);
      const second = await confirmChangeBySelf(token, { db, secret: SECRET, mirror });
      expect(second).toEqual({ ok: false, reason: 'no_pending_change' });
    });
  });

  // ── previewChangeConfirmLink ──────────────────────────────────────────────
  describe('previewChangeConfirmLink', () => {
    it('previews a pending change with booking + driver', async () => {
      const booking = await seed({ status: 'pending', assigned: true });
      const link = await generateChangeConfirmLink(booking.id, operatorId, {
        db,
        secret: SECRET,
        appUrl: APP_URL,
      });
      if (!link.ok) throw new Error('mint failed');
      const res = await previewChangeConfirmLink(tokenFromUrl(link.url), { db, secret: SECRET });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.booking.id).toBe(booking.id);
      expect(res.driver.id).toBe(driverId);
    });

    it('reports no_pending_change once confirmed', async () => {
      const booking = await seed({ status: 'pending', assigned: true });
      const link = await generateChangeConfirmLink(booking.id, operatorId, {
        db,
        secret: SECRET,
        appUrl: APP_URL,
      });
      if (!link.ok) throw new Error('mint failed');
      const token = tokenFromUrl(link.url);
      await confirmChangeBySelf(token, { db, secret: SECRET, mirror });
      const res = await previewChangeConfirmLink(token, { db, secret: SECRET });
      expect(res).toEqual({ ok: false, reason: 'no_pending_change' });
    });
  });

  // ── Auto exec-email on confirming an exec-relevant change ──────────────────
  describe('auto exec-email on confirm', () => {
    it('emails the exec when an exec-relevant change is attested', async () => {
      const notifications = new FakeNotificationAdapter();
      const email = new FakeEmailAdapter();
      const booking = await seed({
        status: 'pending',
        assigned: true,
        execRelevant: true,
        execEmail: 'eric@example.com',
      });
      const res = await confirmChangeOnBehalf(booking.id, operatorId, {
        db,
        mirror,
        notifications,
        email,
      });
      expect(res.ok).toBe(true);
      expect(email.sent.some((m) => m.to === 'eric@example.com')).toBe(true);
      expect(notifications.sent).toHaveLength(0);
      const rows = await db
        .select()
        .from(execNotifications)
        .where(eq(execNotifications.bookingId, booking.id));
      expect(rows.some((r) => r.kind === 'changed' && r.channel === 'email')).toBe(true);
    });

    it('does NOT email the exec when the change is not exec-relevant', async () => {
      const notifications = new FakeNotificationAdapter();
      const email = new FakeEmailAdapter();
      const booking = await seed({
        status: 'pending',
        assigned: true,
        execRelevant: false,
        execEmail: 'eric@example.com',
      });
      const res = await confirmChangeOnBehalf(booking.id, operatorId, {
        db,
        mirror,
        notifications,
        email,
      });
      expect(res.ok).toBe(true);
      expect(email.sent).toHaveLength(0);
    });

    it('confirmation still succeeds when there is no exec email (no send)', async () => {
      const notifications = new FakeNotificationAdapter();
      const email = new FakeEmailAdapter();
      const booking = await seed({
        status: 'pending',
        assigned: true,
        execRelevant: true,
        execEmail: null,
      });
      const res = await confirmChangeOnBehalf(booking.id, operatorId, {
        db,
        mirror,
        notifications,
        email,
      });
      expect(res.ok).toBe(true);
      expect(email.sent).toHaveLength(0);
    });

    it('driver self-confirm also auto-emails the exec on an exec-relevant change', async () => {
      const notifications = new FakeNotificationAdapter();
      const email = new FakeEmailAdapter();
      const booking = await seed({
        status: 'pending',
        assigned: true,
        execRelevant: true,
        execEmail: 'eric@example.com',
      });
      const link = await generateChangeConfirmLink(booking.id, operatorId, {
        db,
        secret: SECRET,
        appUrl: APP_URL,
      });
      if (!link.ok) throw new Error('mint failed');
      const res = await confirmChangeBySelf(tokenFromUrl(link.url), {
        db,
        secret: SECRET,
        mirror,
        notifications,
        email,
      });
      expect(res.ok).toBe(true);
      expect(email.sent.some((m) => m.to === 'eric@example.com')).toBe(true);
    });
  });
});
