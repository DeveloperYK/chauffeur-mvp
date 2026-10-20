import { randomUUID } from 'node:crypto';
import { FakeSpreadsheetMirror } from '@/server/adapters/spreadsheet-mirror-fake';
import {
  auditEvents,
  bookingStops,
  bookings,
  consumedTokens,
  drivers,
  operators,
} from '@/server/db/schema';
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

  // Pickup is 10:00Z = 11:00 London (BST). Driver arrives 10:55, passenger on
  // board 11:12 → the 12-minute wait is DERIVED (on board − booked pickup);
  // the 12:25 London completion resolves to 11:25Z.
  const FORM_TIMES = {
    arrivalTime: '10:55',
    passengerOnBoardTime: '11:12',
    completionTime: '12:25',
  } as const;

  it('generateCompletionLink returns URL + WhatsApp Web link for booking in awaiting_driver_form', async () => {
    const r = await generateCompletionLink(bookingId, operatorId, deps());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.url.startsWith(`${APP_URL}/j/`)).toBe(true);
    expect(r.whatsappUrl.startsWith('https://web.whatsapp.com/send?phone=447911000001')).toBe(true);
  });

  it('generateCompletionLink returns the formatted message WhatsApp pre-fills, with the short link', async () => {
    const r = await generateCompletionLink(bookingId, operatorId, deps());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.whatsappUrl).toBe(
      `https://web.whatsapp.com/send?phone=447911000001&text=${encodeURIComponent(r.message)}`,
    );
    expect(r.message).toContain(r.shortUrl);
    expect(r.message).not.toContain('/j/');
  });

  it('generateCompletionLink stamps completionLinkSentAt so the booking moves from "send form" to "form outstanding"', async () => {
    const before = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(before[0]?.completionLinkSentAt).toBeNull();
    const r = await generateCompletionLink(bookingId, operatorId, deps());
    expect(r.ok).toBe(true);
    const after = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(after[0]?.completionLinkSentAt?.toISOString()).toBe('2026-06-01T11:30:00.000Z');
  });

  it('generateCompletionLink a second time refreshes the sent timestamp (last send wins)', async () => {
    await generateCompletionLink(bookingId, operatorId, deps());
    const later = fixedClock('2026-06-02T09:00:00.000Z');
    await generateCompletionLink(bookingId, operatorId, { ...deps(), clock: later });
    const [row] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(row?.completionLinkSentAt?.toISOString()).toBe('2026-06-02T09:00:00.000Z');
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
    expect(r.booking.waitingTimeMinutes).toBe(12);
    expect(r.booking.dropoffAt?.toISOString()).toBe('2026-06-01T11:25:00.000Z');
    // The reported times are stored: 10:55 / 11:12 London (BST) → 09:55Z / 10:12Z.
    expect(r.booking.arrivalAt?.toISOString()).toBe('2026-06-01T09:55:00.000Z');
    expect(r.booking.passengerOnBoardAt?.toISOString()).toBe('2026-06-01T10:12:00.000Z');

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
        arrivalTime: '22:50',
        passengerOnBoardTime: '23:15', // 15 min after the 23:00 pickup
        completionTime: '01:30', // before the 23:00 pickup → next London day
      },
      deps(),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
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

  it('submitCompletionForm rejects a negative car park fee', async () => {
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

  it('a booking with no contract price completes the full flow: submit → approve → completed', async () => {
    // The operator never learned the price — the booking still runs end to end,
    // stays unpriced (flagged in the console), and is priced later for invoicing.
    await db.update(bookings).set({ contractPricePence: null }).where(eq(bookings.id, bookingId));
    const gen = await generateCompletionLink(bookingId, operatorId, deps());
    if (!gen.ok) throw new Error('setup');
    const token = new URL(gen.url).pathname.split('/').pop() ?? '';
    const submitted = await submitCompletionForm(
      { token, carParkPence: 500, ...FORM_TIMES },
      deps(),
    );
    expect(submitted.ok).toBe(true);
    const approved = await approveBooking(bookingId, operatorId, deps());
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    expect(approved.booking.state).toBe('completed');
    expect(approved.booking.contractPricePence).toBeNull();
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

  it('rejectBooking clears completionLinkSentAt so the operator is prompted to send the form again', async () => {
    await db
      .update(bookings)
      .set({
        state: 'awaiting_operator_review',
        completionLinkSentAt: new Date('2026-06-01T12:00:00.000Z'),
      })
      .where(eq(bookings.id, bookingId));
    const r = await rejectBooking(bookingId, operatorId, deps());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.booking.completionLinkSentAt).toBeNull();
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
      // Completion data is mirrored — Car Park (column P) reflects the submitted £7.50.
      expect(mirror.rows.get(bookingId)?.[15]).toBe('7.50');
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
        { ...input, completionTime: '7:5' },
        operatorId,
        onBehalfDeps(),
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('validation');
    });

    it('rejects an implausibly long derived wait beyond the 12h cap', async () => {
      const r = await completeFormOnBehalf(
        bookingId,
        // Passenger "on board" 00:30 rolls past midnight → 13.5h after the
        // 11:00 London pickup, past the 720-min waiting cap.
        { ...input, passengerOnBoardTime: '00:30', completionTime: '01:30' },
        operatorId,
        onBehalfDeps(),
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('times_invalid');
    });
  });

  describe('multi-stop journeys', () => {
    const onBehalfDeps = () => ({ ...deps(), mirror: new FakeSpreadsheetMirror() });
    async function seedStops() {
      await db.insert(bookingStops).values([
        { bookingId, seq: 1, address: 'Stop A, London E1 6AN', plannedWaitMinutes: 40 },
        { bookingId, seq: 2, address: 'Stop B, London E2 7DG', plannedWaitMinutes: 0 },
      ]);
    }
    async function tokenFor() {
      const gen = await generateCompletionLink(bookingId, operatorId, deps());
      if (!gen.ok) throw new Error('setup');
      return new URL(gen.url).pathname.split('/').pop() ?? '';
    }
    // Pickup 11:00 London. On board 11:12 (12 min), stop A 11:40–12:25 (45),
    // stop B 13:00–13:10 (10) → 67 min waiting, drop-off 13:30.
    const STOP_TIMES = [
      { arrivedTime: '11:40', leftTime: '12:25' },
      { arrivedTime: '13:00', leftTime: '13:10' },
    ];

    it("driver submit records each stop's arrival/departure and sums the waiting", async () => {
      await seedStops();
      const token = await tokenFor();
      const r = await submitCompletionForm(
        { token, carParkPence: 0, ...FORM_TIMES, completionTime: '13:30', stops: STOP_TIMES },
        deps(),
      );
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.booking.waitingTimeMinutes).toBe(67);
      const rows = await db
        .select()
        .from(bookingStops)
        .where(eq(bookingStops.bookingId, bookingId))
        .orderBy(bookingStops.seq);
      expect(rows.map((s) => [s.arrivedAt?.toISOString(), s.departedAt?.toISOString()])).toEqual([
        ['2026-06-01T10:40:00.000Z', '2026-06-01T11:25:00.000Z'],
        ['2026-06-01T12:00:00.000Z', '2026-06-01T12:10:00.000Z'],
      ]);
    });

    it('driver submit rejects a form with the wrong number of stop times (none, or too few)', async () => {
      await seedStops();
      const token = await tokenFor();
      const none = await submitCompletionForm({ token, carParkPence: 0, ...FORM_TIMES }, deps());
      expect(none.ok).toBe(false);
      if (!none.ok) expect(none.reason).toBe('times_invalid');
      const few = await submitCompletionForm(
        { token, carParkPence: 0, ...FORM_TIMES, stops: STOP_TIMES.slice(0, 1) },
        deps(),
      );
      expect(few.ok).toBe(false);
      if (!few.ok) expect(few.reason).toBe('times_invalid');
      const [row] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
      expect(row?.state).toBe('awaiting_driver_form');
    });

    it('a booking with no stops still rejects stop times (nothing to attach them to)', async () => {
      const token = await tokenFor();
      const r = await submitCompletionForm(
        { token, carParkPence: 0, ...FORM_TIMES, stops: STOP_TIMES.slice(0, 1) },
        deps(),
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('times_invalid');
    });

    it('operator completion on behalf records the stop times and the summed waiting', async () => {
      await seedStops();
      const r = await completeFormOnBehalf(
        bookingId,
        { carParkPence: 0, ...FORM_TIMES, completionTime: '13:30', stops: STOP_TIMES },
        operatorId,
        onBehalfDeps(),
      );
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.booking.state).toBe('completed');
      expect(r.booking.waitingTimeMinutes).toBe(67);
      const rows = await db.select().from(bookingStops).orderBy(bookingStops.seq);
      expect(rows.every((s) => s.arrivedAt && s.departedAt)).toBe(true);
    });

    it('operator completion on behalf rejects missing stop times', async () => {
      await seedStops();
      const r = await completeFormOnBehalf(
        bookingId,
        { carParkPence: 0, ...FORM_TIMES },
        operatorId,
        onBehalfDeps(),
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('times_invalid');
    });
  });
});
