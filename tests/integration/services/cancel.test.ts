import { auditEvents, bookings, drivers, operators } from '@/server/db/schema';
import { fixedClock } from '@/server/ports/clock';
import { cancelBooking } from '@/server/services/cancel';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestDb, createTestDb } from '~test/helpers/pglite-db';

describe('services/cancel (integration)', () => {
  let db: TestDb;
  let close: () => Promise<void>;
  let operatorId: string;
  let driverId: string;

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
    await db.delete(bookings);
    await db.delete(drivers);
    const [drv] = await db
      .insert(drivers)
      .values({
        name: 'Tom',
        tier: 'premium',
        defaultCarType: 'Mercedes S-Class',
        whatsappNumber: '+447911000001',
      })
      .returning();
    driverId = drv?.id ?? '';
  });

  async function seed(state: 'unassigned' | 'assigned' | 'in_progress' | 'completed') {
    const [b] = await db
      .insert(bookings)
      .values({
        state,
        pickupAt: new Date('2026-06-01T10:00:00.000Z'),
        expectedDurationMinutes: 60,
        pickupAddress: 'A',
        dropoffAddress: 'B',
        passengerFirstName: 'Eric',
        passengerLastName: 'French',
        execMobile: '+447911999999',
        clientName: 'LEGO Group',
        accountCode: 'LEGO',
        contractPricePence: 30000,
        assignedDriverId: state === 'unassigned' ? null : driverId,
        carForThisJob: state === 'unassigned' ? null : 'Mercedes S-Class',
      })
      .returning();
    return b?.id ?? '';
  }

  const clock = fixedClock('2026-05-20T10:00:00.000Z');
  const deps = () => ({ db, clock });

  it('cancels an unassigned booking and records the reason', async () => {
    const id = await seed('unassigned');
    const r = await cancelBooking(
      { bookingId: id, reason: 'Client cancelled by phone' },
      operatorId,
      deps(),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.booking.state).toBe('cancelled');
    expect(r.booking.cancellationReason).toBe('Client cancelled by phone');
    expect(r.booking.cancelledByOperatorId).toBe(operatorId);
    expect(r.booking.cancelledAt?.toISOString()).toBe('2026-05-20T10:00:00.000Z');
  });

  it('cancels an assigned booking', async () => {
    const id = await seed('assigned');
    const r = await cancelBooking(
      { bookingId: id, reason: 'Driver no longer available' },
      operatorId,
      deps(),
    );
    expect(r.ok).toBe(true);
  });

  it('cancels an in_progress booking', async () => {
    const id = await seed('in_progress');
    const r = await cancelBooking(
      { bookingId: id, reason: 'Trip aborted mid-route' },
      operatorId,
      deps(),
    );
    expect(r.ok).toBe(true);
  });

  it('refuses to cancel a completed booking', async () => {
    const id = await seed('completed');
    const r = await cancelBooking(
      { bookingId: id, reason: 'Too late but worth a try' },
      operatorId,
      deps(),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('wrong_state');
  });

  it('rejects an empty reason', async () => {
    const id = await seed('unassigned');
    const r = await cancelBooking({ bookingId: id, reason: '' }, operatorId, deps());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('validation');
  });

  it('rejects a too-short reason', async () => {
    const id = await seed('unassigned');
    const r = await cancelBooking({ bookingId: id, reason: 'nope' }, operatorId, deps());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('validation');
  });

  it('trims the reason and writes the cleaned form', async () => {
    const id = await seed('unassigned');
    const r = await cancelBooking(
      { bookingId: id, reason: '   Client cancelled by phone   ' },
      operatorId,
      deps(),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.booking.cancellationReason).toBe('Client cancelled by phone');
  });

  it('returns booking_not_found for unknown id', async () => {
    const r = await cancelBooking(
      { bookingId: '00000000-0000-0000-0000-000000000099', reason: 'Whatever, longer than five' },
      operatorId,
      deps(),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('booking_not_found');
  });

  it('writes a cancel audit event with the reason', async () => {
    const id = await seed('assigned');
    await cancelBooking({ bookingId: id, reason: 'Driver no-show' }, operatorId, deps());
    const events = await db.select().from(auditEvents);
    const cancel = events.find((e) => e.action === 'cancel');
    expect(cancel).toBeDefined();
    expect(cancel?.actorType).toBe('operator');
    expect(cancel?.actorId).toBe(operatorId);
    const after = cancel?.after as { state: string; reason: string };
    expect(after.state).toBe('cancelled');
    expect(after.reason).toBe('Driver no-show');
  });
});
