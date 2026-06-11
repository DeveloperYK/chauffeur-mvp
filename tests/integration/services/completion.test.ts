import { randomUUID } from 'node:crypto';
import { FakeSpreadsheetMirror } from '@/server/adapters/spreadsheet-mirror-fake';
import { auditEvents, bookings, consumedTokens, drivers, operators } from '@/server/db/schema';
import { completionLinkExpiry } from '@/server/domain/durations';
import { signDriverLink } from '@/server/domain/link-tokens';
import { fixedClock } from '@/server/ports/clock';
import {
  approveBooking,
  completeFormOnBehalf,
  generateCompletionLink,
  rejectBooking,
  submitCompletionForm,
} from '@/server/services/completion';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestDb, createTestDb } from '~test/helpers/pglite-db';

const SECRET = 'test-completion-secret-must-be-at-least-32-characters';
const APP_URL = 'https://example.test';

describe('services/completion (integration)', () => {
  let db: TestDb;
  let close: () => Promise<void>;
  let operatorId: string;
  let driverId: string;
  let bookingId: string;

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
    const [drv] = await db
      .insert(drivers)
      .values({
        name: 'Tom',
        vehicleClass: 'executive',
        car: 'Mercedes S-Class',
        carColour: 'Black',
        whatsappNumber: '+447911000001',
      })
      .returning();
    driverId = drv?.id ?? '';
    const [b] = await db
      .insert(bookings)
      .values({
        state: 'awaiting_driver_form',
        assignedDriverId: driverId,
        assignedAt: new Date('2026-05-18T08:30:00.000Z'),
        pickupAt: new Date('2026-06-01T10:00:00.000Z'),
        expectedDurationMinutes: 90,
        pickupAddress: 'A',
        dropoffAddress: 'B',
        passengerFirstName: 'Eric',
        passengerLastName: 'French',
        execMobile: '+447911999999',
        clientName: 'LEGO Group',
        accountCode: 'LEGO',
        contractPricePence: 30000,
      })
      .returning();
    bookingId = b?.id ?? '';
  });

  const clock = fixedClock('2026-06-01T11:30:00.000Z');
  const deps = () => ({ db, clock, secret: SECRET, appUrl: APP_URL });

  // Pickup is 10:00Z = 11:00 London (BST). These London times resolve to
  // arrival 09:50Z, on-board 10:02Z (→ 12 min wait), completion 11:25Z.
  const FORM_TIMES = {
    arrivalTime: '10:50',
    passengerOnBoardTime: '11:02',
    completionTime: '12:25',
  } as const;

  it('generateCompletionLink returns URL + WhatsApp Web link for booking in awaiting_driver_form', async () => {
    const r = await generateCompletionLink(bookingId, operatorId, deps());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.url.startsWith(`${APP_URL}/j/`)).toBe(true);
    expect(r.whatsappUrl.startsWith('https://web.whatsapp.com/send?phone=447911000001')).toBe(true);
  });

  it('generateCompletionLink refuses when not awaiting_driver_form', async () => {
    await db.update(bookings).set({ state: 'assigned' }).where(eq(bookings.id, bookingId));
    const r = await generateCompletionLink(bookingId, operatorId, deps());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('wrong_state');
  });

  it('submitCompletionForm transitions to awaiting_operator_review and stores form data', async () => {
    const gen = await generateCompletionLink(bookingId, operatorId, deps());
    if (!gen.ok) throw new Error('setup');
    const token = new URL(gen.url).pathname.split('/').pop() ?? '';

    const r = await submitCompletionForm({ token, carParkPence: 750, ...FORM_TIMES }, deps());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.booking.state).toBe('awaiting_operator_review');
    expect(r.booking.carParkPence).toBe(750);
    expect(r.booking.arrivalAt?.toISOString()).toBe('2026-06-01T09:50:00.000Z');
    expect(r.booking.passengerOnBoardAt?.toISOString()).toBe('2026-06-01T10:02:00.000Z');
    expect(r.booking.waitingTimeMinutes).toBe(12);
    expect(r.booking.dropoffAt?.toISOString()).toBe('2026-06-01T11:25:00.000Z');

    expect((await db.select().from(consumedTokens)).length).toBe(1);

    const event = (await db.select().from(auditEvents)).find(
      (e) => e.action === 'driver_submit_form',
    );
    expect(event?.actorType).toBe('driver');
    expect(event?.actorId).toBe(driverId);
  });

  it('submitCompletionForm rolls a past-midnight completion to the next day', async () => {
    // A late booking: pickup 23:00 London (BST → 22:00Z) on 1 Jun.
    const [late] = await db
      .insert(bookings)
      .values({
        state: 'awaiting_driver_form',
        assignedDriverId: driverId,
        assignedAt: new Date('2026-05-18T08:30:00.000Z'),
        pickupAt: new Date('2026-06-01T22:00:00.000Z'),
        expectedDurationMinutes: 90,
        pickupAddress: 'A',
        dropoffAddress: 'B',
        passengerFirstName: 'Nora',
        execMobile: '+447911999998',
        clientName: 'LEGO Group',
        accountCode: 'LEGO',
        contractPricePence: 30000,
      })
      .returning();
    const lateId = late?.id ?? '';
    const gen = await generateCompletionLink(lateId, operatorId, deps());
    if (!gen.ok) throw new Error('setup');
    const token = new URL(gen.url).pathname.split('/').pop() ?? '';

    const r = await submitCompletionForm(
      {
        token,
        carParkPence: 0,
        arrivalTime: '23:05',
        passengerOnBoardTime: '23:20',
        completionTime: '01:30', // before on-board → next London day
      },
      deps(),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.booking.arrivalAt?.toISOString()).toBe('2026-06-01T22:05:00.000Z');
    expect(r.booking.dropoffAt?.toISOString()).toBe('2026-06-02T00:30:00.000Z');
    expect(r.booking.waitingTimeMinutes).toBe(15);
  });

  it('submitCompletionForm refuses replay', async () => {
    const gen = await generateCompletionLink(bookingId, operatorId, deps());
    if (!gen.ok) throw new Error('setup');
    const token = new URL(gen.url).pathname.split('/').pop() ?? '';
    await submitCompletionForm({ token, carParkPence: 0, ...FORM_TIMES }, deps());
    const r = await submitCompletionForm({ token, carParkPence: 0, ...FORM_TIMES }, deps());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('token_consumed');
  });

  it('submitCompletionForm rejects negative car park / waiting', async () => {
    const gen = await generateCompletionLink(bookingId, operatorId, deps());
    if (!gen.ok) throw new Error('setup');
    const token = new URL(gen.url).pathname.split('/').pop() ?? '';
    const r = await submitCompletionForm({ token, carParkPence: -1, ...FORM_TIMES }, deps());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('validation');
  });

  it('submitCompletionForm rejects dispatch-typed token (wrong_type)', async () => {
    const dispatchToken = await signDriverLink(SECRET, {
      jobId: bookingId,
      driverId,
      type: 'dispatch',
      jti: randomUUID(),
      now: clock.now(),
      expiresAt: completionLinkExpiry(new Date('2026-06-01T10:00:00.000Z')),
    });
    const r = await submitCompletionForm(
      { token: dispatchToken, carParkPence: 0, ...FORM_TIMES },
      deps(),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('wrong_type');
  });

  it('approveBooking transitions awaiting_operator_review → completed', async () => {
    await db
      .update(bookings)
      .set({ state: 'awaiting_operator_review' })
      .where(eq(bookings.id, bookingId));
    const r = await approveBooking(bookingId, operatorId, deps());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.booking.state).toBe('completed');
      expect(r.booking.approvedByOperatorId).toBe(operatorId);
      expect(r.booking.approvedAt).not.toBeNull();
    }
  });

  it('rejectBooking transitions awaiting_operator_review → awaiting_driver_form', async () => {
    await db
      .update(bookings)
      .set({ state: 'awaiting_operator_review' })
      .where(eq(bookings.id, bookingId));
    const r = await rejectBooking(bookingId, operatorId, deps());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.booking.state).toBe('awaiting_driver_form');
  });

  it('approveBooking refuses from non-awaiting_operator_review state', async () => {
    const r = await approveBooking(bookingId, operatorId, deps()); // still awaiting_driver_form
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('wrong_state');
  });

  it('end-to-end: generate → submit → approve writes full audit trail', async () => {
    const gen = await generateCompletionLink(bookingId, operatorId, deps());
    if (!gen.ok) throw new Error('setup');
    const token = new URL(gen.url).pathname.split('/').pop() ?? '';
    await submitCompletionForm({ token, carParkPence: 500, ...FORM_TIMES }, deps());
    await approveBooking(bookingId, operatorId, deps());
    const events = await db.select().from(auditEvents);
    const actions = events.map((e) => e.action);
    expect(actions).toEqual([
      'completion_link_generated',
      'driver_submit_form',
      'operator_approve',
    ]);
  });

  describe('backfill bookings (no internal driver)', () => {
    async function seedBackfillAwaitingForm() {
      const [b] = await db
        .insert(bookings)
        .values({
          state: 'awaiting_driver_form',
          assignedDriverId: null,
          isBackfill: true,
          backfillDriverName: 'Dave Smith',
          backfillDriverPhone: '+447911123456',
          assignedAt: new Date('2026-05-18T08:30:00.000Z'),
          pickupAt: new Date('2026-06-01T10:00:00.000Z'),
          expectedDurationMinutes: 90,
          pickupAddress: 'A',
          dropoffAddress: 'B',
          passengerFirstName: 'Eric',
          passengerLastName: 'French',
          execMobile: '+447911999999',
          clientName: 'LEGO Group',
          accountCode: 'LEGO',
          contractPricePence: 30000,
        })
        .returning();
      return b?.id ?? '';
    }

    it('generates a completion link to the backfill driver phone (no Driver row)', async () => {
      const id = await seedBackfillAwaitingForm();
      const r = await generateCompletionLink(id, operatorId, deps());
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.driver).toBeNull();
      expect(r.whatsappUrl.startsWith('https://web.whatsapp.com/send?phone=447911123456')).toBe(
        true,
      );
    });

    it('lets the backfill driver submit the form → awaiting_operator_review, audited without a driver id', async () => {
      const id = await seedBackfillAwaitingForm();
      const gen = await generateCompletionLink(id, operatorId, deps());
      if (!gen.ok) throw new Error('setup');
      const token = new URL(gen.url).pathname.split('/').pop() ?? '';

      const r = await submitCompletionForm({ token, carParkPence: 600, ...FORM_TIMES }, deps());
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.booking.state).toBe('awaiting_operator_review');
      expect(r.booking.carParkPence).toBe(600);

      const event = (await db.select().from(auditEvents)).find(
        (e) => e.action === 'driver_submit_form',
      );
      expect(event?.actorType).toBe('driver');
      expect(event?.actorId).toBeNull();
    });

    it('full backfill arm: generate → submit → approve → completed', async () => {
      const id = await seedBackfillAwaitingForm();
      const gen = await generateCompletionLink(id, operatorId, deps());
      if (!gen.ok) throw new Error('setup');
      const token = new URL(gen.url).pathname.split('/').pop() ?? '';
      await submitCompletionForm({ token, carParkPence: 0, ...FORM_TIMES }, deps());
      const approved = await approveBooking(id, operatorId, deps());
      expect(approved.ok).toBe(true);
      if (approved.ok) expect(approved.booking.state).toBe('completed');
    });
  });

  describe('completeFormOnBehalf — operator enters the form', () => {
    let mirror: FakeSpreadsheetMirror;
    const onBehalfDeps = () => ({ db, clock, secret: SECRET, appUrl: APP_URL, mirror });

    beforeEach(() => {
      mirror = new FakeSpreadsheetMirror();
    });

    const input = { carParkPence: 750, ...FORM_TIMES };

    it('completes the booking directly, skipping operator review, marked as operator-entered', async () => {
      const r = await completeFormOnBehalf(bookingId, input, operatorId, onBehalfDeps());
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.booking.state).toBe('completed');
      expect(r.booking.completionByOperator).toBe(true);
      expect(r.booking.carParkPence).toBe(750);
      expect(r.booking.waitingTimeMinutes).toBe(12);
      expect(r.booking.dropoffAt?.toISOString()).toBe('2026-06-01T11:25:00.000Z');
      expect(r.booking.completionSubmittedAt).not.toBeNull();
      expect(r.booking.approvedAt).not.toBeNull();
      expect(r.booking.approvedByOperatorId).toBe(operatorId);
    });

    it('records an operator_completed_form audit event (actor = operator) and mirrors', async () => {
      await completeFormOnBehalf(bookingId, input, operatorId, onBehalfDeps());
      const event = (await db.select().from(auditEvents)).find(
        (e) => e.action === 'operator_completed_form',
      );
      expect(event?.actorType).toBe('operator');
      expect(event?.actorId).toBe(operatorId);
      expect(mirror.rows.get(bookingId)?.[18]).toBe('Yes'); // column S — Raise an invoice?? when completed
    });

    it('refuses a stale driver link submit after the operator has completed (no double submit)', async () => {
      const gen = await generateCompletionLink(bookingId, operatorId, deps());
      if (!gen.ok) throw new Error('setup');
      const token = new URL(gen.url).pathname.split('/').pop() ?? '';
      await completeFormOnBehalf(bookingId, input, operatorId, onBehalfDeps());
      const late = await submitCompletionForm({ token, carParkPence: 0, ...FORM_TIMES }, deps());
      expect(late.ok).toBe(false);
      if (!late.ok) expect(late.reason).toBe('wrong_state');
    });

    it('rejects a missing booking', async () => {
      const r = await completeFormOnBehalf(
        '00000000-0000-0000-0000-000000000000',
        input,
        operatorId,
        onBehalfDeps(),
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('booking_not_found');
    });

    it('rejects a booking that is not awaiting the driver form', async () => {
      await db.update(bookings).set({ state: 'in_progress' }).where(eq(bookings.id, bookingId));
      const r = await completeFormOnBehalf(bookingId, input, operatorId, onBehalfDeps());
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('wrong_state');
    });

    it('rejects negative car park', async () => {
      const r = await completeFormOnBehalf(
        bookingId,
        { ...input, carParkPence: -1 },
        operatorId,
        onBehalfDeps(),
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('validation');
    });

    it('rejects a malformed time', async () => {
      const r = await completeFormOnBehalf(
        bookingId,
        { ...input, arrivalTime: '7:5' },
        operatorId,
        onBehalfDeps(),
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('validation');
    });

    it('rejects an implausibly long derived wait (times_invalid)', async () => {
      const r = await completeFormOnBehalf(
        bookingId,
        // 08:00 → 21:00 is a 13h wait, past the 12h cap.
        { ...input, arrivalTime: '08:00', passengerOnBoardTime: '21:00', completionTime: '21:30' },
        operatorId,
        onBehalfDeps(),
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('times_invalid');
    });
  });
});
