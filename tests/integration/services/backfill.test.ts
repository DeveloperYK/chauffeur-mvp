import { FakeNotificationAdapter } from '@/server/adapters/notification-fake';
import { FakeSpreadsheetMirror } from '@/server/adapters/spreadsheet-mirror-fake';
import { auditEvents, bookings, consumedTokens, drivers, operators } from '@/server/db/schema';
import { fixedClock } from '@/server/ports/clock';
import { listBookingHistory } from '@/server/services/activity';
import { handToBackfill, updateBackfillPay } from '@/server/services/backfill';
import { releaseDriver } from '@/server/services/dispatch';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SeedData } from '~test/fixtures/seed-data';
import { type TestDb, createTestDb } from '~test/helpers/pglite-db';

const NOW = new Date('2026-05-20T09:00:00.000Z');

describe('services/backfill (integration)', () => {
  let db: TestDb;
  let close: () => Promise<void>;
  let operatorId: string;
  let notifications: FakeNotificationAdapter;
  let mirror: FakeSpreadsheetMirror;

  const deps = () => ({
    db,
    clock: fixedClock(NOW),
    notifications,
    mirror,
  });

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
    mirror = new FakeSpreadsheetMirror();
  });

  async function seedUnassigned() {
    const [b] = await db
      .insert(bookings)
      .values(SeedData.bookings.unassigned(operatorId))
      .returning();
    return b?.id ?? '';
  }

  const validInput = {
    name: 'Dave Smith',
    phone: '+44 7911 123456',
    car: 'BMW 5 Series',
    payPence: 12000,
  };

  describe('handToBackfill — happy paths', () => {
    it('moves an unassigned booking to assigned, flagged as backfill', async () => {
      const id = await seedUnassigned();
      const result = await handToBackfill(id, validInput, operatorId, deps());
      expect(result.ok).toBe(true);

      const [b] = await db.select().from(bookings).where(eq(bookings.id, id));
      expect(b?.state).toBe('assigned');
      expect(b?.isBackfill).toBe(true);
      expect(b?.assignedDriverId).toBeNull();
      expect(b?.backfillDriverName).toBe('Dave Smith');
      expect(b?.backfillCar).toBe('BMW 5 Series');
      expect(b?.backfillDriverPayPence).toBe(12000);
      expect(b?.assignedAt).not.toBeNull();
    });

    it('normalises the backfill phone to E.164', async () => {
      const id = await seedUnassigned();
      await handToBackfill(id, validInput, operatorId, deps());
      const [b] = await db.select().from(bookings).where(eq(bookings.id, id));
      expect(b?.backfillDriverPhone).toBe('+447911123456');
    });

    it('sends the exec the assignment SMS naming the backfill driver and car', async () => {
      const id = await seedUnassigned();
      await handToBackfill(id, validInput, operatorId, deps());
      expect(notifications.sent.length).toBe(1);
      expect(notifications.sent[0]?.to).toBe('+447911999999');
      expect(notifications.sent[0]?.body).toContain('Dave Smith');
      expect(notifications.sent[0]?.body).toContain('BMW 5 Series');
    });

    it('mirrors the booking with the backfill name in the Driver Name column', async () => {
      const id = await seedUnassigned();
      await handToBackfill(id, validInput, operatorId, deps());
      const row = mirror.rows.get(id);
      expect(row?.[12]).toBe('Dave Smith'); // column M — Driver Name
    });

    it('records a hand_to_backfill audit event', async () => {
      const id = await seedUnassigned();
      await handToBackfill(id, validInput, operatorId, deps());
      const events = await db.select().from(auditEvents).where(eq(auditEvents.entityId, id));
      expect(events.some((e) => e.action === 'hand_to_backfill')).toBe(true);
    });

    it('reads in the history as the backfill driver being assigned to the booking', async () => {
      const id = await seedUnassigned();
      await handToBackfill(id, validInput, operatorId, deps());
      const history = await listBookingHistory(db, id);
      const entry = history.find((h) => h.text.includes('backfill driver'));
      expect(entry?.text).toBe('assigned backfill driver Dave Smith to the booking.');
    });
  });

  describe('handToBackfill — unhappy paths', () => {
    it('rejects a missing booking', async () => {
      const result = await handToBackfill(
        '00000000-0000-0000-0000-000000000000',
        validInput,
        operatorId,
        deps(),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('booking_not_found');
    });

    it('rejects a booking that is not unassigned', async () => {
      const [b] = await db
        .insert(bookings)
        .values(SeedData.bookings.unassigned(operatorId, { state: 'in_progress' }))
        .returning();
      const result = await handToBackfill(b?.id ?? '', validInput, operatorId, deps());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('wrong_state');
    });

    it('rejects an empty driver name', async () => {
      const id = await seedUnassigned();
      const result = await handToBackfill(id, { ...validInput, name: '' }, operatorId, deps());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('validation');
    });

    it('rejects an invalid phone number', async () => {
      const id = await seedUnassigned();
      const result = await handToBackfill(id, { ...validInput, phone: 'nope' }, operatorId, deps());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('validation');
    });

    it('rejects an empty car', async () => {
      const id = await seedUnassigned();
      const result = await handToBackfill(id, { ...validInput, car: '' }, operatorId, deps());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('validation');
    });

    it('rejects a missing driver pay', async () => {
      const id = await seedUnassigned();
      const { payPence, ...noPay } = validInput;
      const result = await handToBackfill(id, noPay as typeof validInput, operatorId, deps());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('validation');
    });

    it('rejects a zero or negative driver pay', async () => {
      const id = await seedUnassigned();
      const result = await handToBackfill(id, { ...validInput, payPence: 0 }, operatorId, deps());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('validation');
    });

    it('does not send an SMS or mirror when validation fails', async () => {
      const id = await seedUnassigned();
      await handToBackfill(id, { ...validInput, name: '' }, operatorId, deps());
      expect(notifications.sent.length).toBe(0);
      expect(mirror.rows.size).toBe(0);
    });
  });

  describe('releasing a backfill booking (driver pulled out)', () => {
    it('returns the booking to a clean unassigned ticket and clears the backfill fields', async () => {
      const id = await seedUnassigned();
      await handToBackfill(id, validInput, operatorId, deps());

      const released = await releaseDriver(id, operatorId, {
        ...deps(),
        secret: 'test-secret-must-be-at-least-32-characters-long',
        appUrl: 'https://example.test',
      });
      expect(released.ok).toBe(true);

      const [b] = await db.select().from(bookings).where(eq(bookings.id, id));
      expect(b?.state).toBe('unassigned');
      expect(b?.isBackfill).toBe(false);
      expect(b?.backfillDriverName).toBeNull();
      expect(b?.backfillDriverPhone).toBeNull();
      expect(b?.backfillCar).toBeNull();
      expect(b?.backfillDriverPayPence).toBeNull();
    });
  });

  describe('updateBackfillPay', () => {
    async function seedBackfill() {
      const id = await seedUnassigned();
      await handToBackfill(id, validInput, operatorId, deps());
      return id;
    }

    it('updates the backfill driver pay', async () => {
      const id = await seedBackfill();
      const result = await updateBackfillPay(id, 15500, operatorId, deps());
      expect(result.ok).toBe(true);
      const [b] = await db.select().from(bookings).where(eq(bookings.id, id));
      expect(b?.backfillDriverPayPence).toBe(15500);
    });

    it('records an audit event for the pay change', async () => {
      const id = await seedBackfill();
      await updateBackfillPay(id, 15500, operatorId, deps());
      const events = await db.select().from(auditEvents).where(eq(auditEvents.entityId, id));
      expect(events.some((e) => e.action === 'update_backfill_pay')).toBe(true);
    });

    it('rejects a missing booking', async () => {
      const result = await updateBackfillPay(
        '00000000-0000-0000-0000-000000000000',
        15500,
        operatorId,
        deps(),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('booking_not_found');
    });

    it('rejects a booking that is not a backfill job', async () => {
      const id = await seedUnassigned();
      const result = await updateBackfillPay(id, 15500, operatorId, deps());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('not_backfill');
    });

    it('rejects a zero or negative pay', async () => {
      const id = await seedBackfill();
      const result = await updateBackfillPay(id, 0, operatorId, deps());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('validation');
    });
  });
});
