import { randomUUID } from 'node:crypto';
import { auditEvents, bookings, consumedTokens, drivers, operators } from '@/server/db/schema';
import { completionLinkExpiry } from '@/server/domain/durations';
import { signDriverLink } from '@/server/domain/link-tokens';
import { fixedClock } from '@/server/ports/clock';
import {
  approveBooking,
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
        tier: 'premium',
        defaultCarType: 's_class',
        whatsappNumber: '+447911000001',
      })
      .returning();
    driverId = drv?.id ?? '';
    const [b] = await db
      .insert(bookings)
      .values({
        state: 'awaiting_driver_form',
        assignedDriverId: driverId,
        carForThisJob: 's_class',
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

  it('generateCompletionLink returns URL + sms: link for booking in awaiting_driver_form', async () => {
    const r = await generateCompletionLink(bookingId, operatorId, deps());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.url.startsWith(`${APP_URL}/j/`)).toBe(true);
    expect(r.smsUrl.startsWith('sms:+447911000001')).toBe(true);
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

    const r = await submitCompletionForm(
      {
        token,
        carParkPence: 750,
        waitingTimeMinutes: 12,
        dropoffAt: '2026-06-01T11:25:00.000Z',
      },
      deps(),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.booking.state).toBe('awaiting_operator_review');
    expect(r.booking.carParkPence).toBe(750);
    expect(r.booking.waitingTimeMinutes).toBe(12);
    expect(r.booking.dropoffAt?.toISOString()).toBe('2026-06-01T11:25:00.000Z');

    expect((await db.select().from(consumedTokens)).length).toBe(1);

    const event = (await db.select().from(auditEvents)).find(
      (e) => e.action === 'driver_submit_form',
    );
    expect(event?.actorType).toBe('driver');
    expect(event?.actorId).toBe(driverId);
  });

  it('submitCompletionForm refuses replay', async () => {
    const gen = await generateCompletionLink(bookingId, operatorId, deps());
    if (!gen.ok) throw new Error('setup');
    const token = new URL(gen.url).pathname.split('/').pop() ?? '';
    await submitCompletionForm(
      { token, carParkPence: 0, waitingTimeMinutes: 0, dropoffAt: '2026-06-01T11:25:00.000Z' },
      deps(),
    );
    const r = await submitCompletionForm(
      { token, carParkPence: 0, waitingTimeMinutes: 0, dropoffAt: '2026-06-01T11:25:00.000Z' },
      deps(),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('token_consumed');
  });

  it('submitCompletionForm rejects negative car park / waiting', async () => {
    const gen = await generateCompletionLink(bookingId, operatorId, deps());
    if (!gen.ok) throw new Error('setup');
    const token = new URL(gen.url).pathname.split('/').pop() ?? '';
    const r = await submitCompletionForm(
      { token, carParkPence: -1, waitingTimeMinutes: 0, dropoffAt: '2026-06-01T11:25:00.000Z' },
      deps(),
    );
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
      {
        token: dispatchToken,
        carParkPence: 0,
        waitingTimeMinutes: 0,
        dropoffAt: '2026-06-01T11:25:00.000Z',
      },
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
    await submitCompletionForm(
      { token, carParkPence: 500, waitingTimeMinutes: 5, dropoffAt: '2026-06-01T11:25:00.000Z' },
      deps(),
    );
    await approveBooking(bookingId, operatorId, deps());
    const events = await db.select().from(auditEvents);
    const actions = events.map((e) => e.action);
    expect(actions).toEqual([
      'completion_link_generated',
      'driver_submit_form',
      'operator_approve',
    ]);
  });
});
