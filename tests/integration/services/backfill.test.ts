import { FakeNotificationAdapter } from '@/server/adapters/notification-fake';
import { FakeSpreadsheetMirror } from '@/server/adapters/spreadsheet-mirror-fake';
import { auditEvents, bookings, consumedTokens, drivers, operators } from '@/server/db/schema';
import { fixedClock } from '@/server/ports/clock';
import { closeOutBackfill, handToBackfill } from '@/server/services/backfill';
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
      expect(b?.carForThisJob).toBe('BMW 5 Series');
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

    it('does not send an SMS or mirror when validation fails', async () => {
      const id = await seedUnassigned();
      await handToBackfill(id, { ...validInput, name: '' }, operatorId, deps());
      expect(notifications.sent.length).toBe(0);
      expect(mirror.rows.size).toBe(0);
    });
  });

  describe('closeOutBackfill — happy paths', () => {
    async function seedInProgressBackfill() {
      const [b] = await db
        .insert(bookings)
        .values(SeedData.backfill.inProgress(operatorId))
        .returning();
      return b?.id ?? '';
    }

    const closeInput = {
      dropoffAt: new Date('2026-05-20T11:30:00.000Z'),
      waitingTimeMinutes: 20,
      carParkPence: 500,
    };

    it('moves an in-progress backfill booking directly to completed', async () => {
      const id = await seedInProgressBackfill();
      const result = await closeOutBackfill(id, closeInput, operatorId, deps());
      expect(result.ok).toBe(true);

      const [b] = await db.select().from(bookings).where(eq(bookings.id, id));
      expect(b?.state).toBe('completed');
      expect(b?.waitingTimeMinutes).toBe(20);
      expect(b?.carParkPence).toBe(500);
      expect(b?.dropoffAt).not.toBeNull();
      expect(b?.completionSubmittedAt).not.toBeNull();
      expect(b?.approvedAt).not.toBeNull();
    });

    it('records a backfill_completed audit event and mirrors', async () => {
      const id = await seedInProgressBackfill();
      await closeOutBackfill(id, closeInput, operatorId, deps());
      const events = await db.select().from(auditEvents).where(eq(auditEvents.entityId, id));
      expect(events.some((e) => e.action === 'backfill_completed')).toBe(true);
      expect(mirror.rows.get(id)?.[18]).toBe('Yes'); // column S — Raise an invoice?? = Yes when completed
    });
  });

  describe('closeOutBackfill — unhappy paths', () => {
    it('rejects a missing booking', async () => {
      const result = await closeOutBackfill(
        '00000000-0000-0000-0000-000000000000',
        { dropoffAt: new Date(), waitingTimeMinutes: 0, carParkPence: 0 },
        operatorId,
        deps(),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('booking_not_found');
    });

    it('rejects a non-backfill in-progress booking', async () => {
      const [drv] = await db.insert(drivers).values(SeedData.drivers.premiumTom()).returning();
      const [b] = await db
        .insert(bookings)
        .values(SeedData.bookings.inProgress(operatorId, drv?.id ?? ''))
        .returning();
      const result = await closeOutBackfill(
        b?.id ?? '',
        { dropoffAt: new Date(), waitingTimeMinutes: 0, carParkPence: 0 },
        operatorId,
        deps(),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('not_backfill');
    });

    it('rejects a backfill booking that is not in progress', async () => {
      const [b] = await db
        .insert(bookings)
        .values(SeedData.backfill.assigned(operatorId))
        .returning();
      const result = await closeOutBackfill(
        b?.id ?? '',
        { dropoffAt: new Date(), waitingTimeMinutes: 0, carParkPence: 0 },
        operatorId,
        deps(),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('wrong_state');
    });

    it('rejects negative waiting minutes', async () => {
      const [b] = await db
        .insert(bookings)
        .values(SeedData.backfill.inProgress(operatorId))
        .returning();
      const result = await closeOutBackfill(
        b?.id ?? '',
        {
          dropoffAt: new Date('2026-05-20T11:30:00.000Z'),
          waitingTimeMinutes: -5,
          carParkPence: 0,
        },
        operatorId,
        deps(),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('validation');
    });
  });
});
