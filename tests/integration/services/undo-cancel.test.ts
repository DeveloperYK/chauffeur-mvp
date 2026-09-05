import { FakeSpreadsheetMirror } from '@/server/adapters/spreadsheet-mirror-fake';
import { auditEvents, bookings, drivers, operators } from '@/server/db/schema';
import { UNDO_CANCEL_WINDOW_MS } from '@/server/domain/undo-window';
import { fixedClock } from '@/server/ports/clock';
import { cancelBooking } from '@/server/services/cancel';
import { undoCancel } from '@/server/services/undo-cancel';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestDb, createTestDb } from '~test/helpers/pglite-db';

describe('services/undo-cancel (integration)', () => {
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
        vehicleClass: 'executive',
        car: 'Mercedes S-Class',
        carColour: 'Black',
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
      })
      .returning();
    return b?.id ?? '';
  }

  const cancelledAtIso = '2026-05-20T10:00:00.000Z';
  const cancelClock = fixedClock(cancelledAtIso);
  const clockAfter = (ms: number) =>
    fixedClock(new Date(new Date(cancelledAtIso).getTime() + ms).toISOString());

  async function cancelled(
    state: 'unassigned' | 'assigned' | 'in_progress',
    mirror?: FakeSpreadsheetMirror,
  ) {
    const id = await seed(state);
    const r = await cancelBooking({ bookingId: id }, operatorId, {
      db,
      clock: cancelClock,
      ...(mirror ? { mirror } : {}),
    });
    expect(r.ok).toBe(true);
    return id;
  }

  // Happy paths.
  it('returns an unassigned booking to unassigned and clears the cancel fields', async () => {
    const id = await cancelled('unassigned');
    const r = await undoCancel(id, operatorId, { db, clock: clockAfter(5_000) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.booking.state).toBe('unassigned');
    expect(r.booking.cancelledAt).toBeNull();
    expect(r.booking.cancelledByOperatorId).toBeNull();
    expect(r.booking.cancellationReason).toBeNull();
    expect(r.booking.stateBeforeCancel).toBeNull();
  });

  it('returns an assigned booking to assigned with its driver still attached', async () => {
    const id = await cancelled('assigned');
    const r = await undoCancel(id, operatorId, { db, clock: clockAfter(30_000) });
    expect(r.ok && r.booking.state).toBe('assigned');
    expect(r.ok && r.booking.assignedDriverId).toBe(driverId);
  });

  it('puts the row back in the spreadsheet mirror', async () => {
    const mirror = new FakeSpreadsheetMirror();
    const id = await cancelled('unassigned', mirror);
    expect(mirror.rows.has(id)).toBe(false);
    const r = await undoCancel(id, operatorId, { db, clock: clockAfter(1_000), mirror });
    expect(r.ok).toBe(true);
    expect(mirror.rows.has(id)).toBe(true);
  });

  it('writes an undo_cancel audit event with before/after states', async () => {
    const id = await cancelled('assigned');
    await undoCancel(id, operatorId, { db, clock: clockAfter(1_000) });
    const events = await db.select().from(auditEvents).where(eq(auditEvents.entityId, id));
    const undo = events.find((e) => e.action === 'undo_cancel');
    expect(undo).toBeDefined();
    expect(undo?.actorId).toBe(operatorId);
    expect(undo?.before).toEqual({ state: 'cancelled' });
    expect(undo?.after).toEqual({ state: 'assigned' });
  });

  // Unhappy paths.
  it('refuses once the undo window has passed', async () => {
    const id = await cancelled('unassigned');
    const r = await undoCancel(id, operatorId, { db, clock: clockAfter(UNDO_CANCEL_WINDOW_MS) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('too_late');
    const [row] = await db.select().from(bookings).where(eq(bookings.id, id));
    expect(row?.state).toBe('cancelled');
  });

  it('refuses a booking that is not cancelled', async () => {
    const id = await seed('assigned');
    const r = await undoCancel(id, operatorId, { db, clock: clockAfter(0) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('not_cancelled');
  });

  it('returns booking_not_found for an unknown id', async () => {
    const r = await undoCancel('00000000-0000-0000-0000-000000000000', operatorId, {
      db,
      clock: clockAfter(0),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('booking_not_found');
  });

  it('refuses a legacy cancellation with no recorded prior state', async () => {
    const id = await seed('unassigned');
    await db
      .update(bookings)
      .set({ state: 'cancelled', cancelledAt: new Date(cancelledAtIso), stateBeforeCancel: null })
      .where(eq(bookings.id, id));
    const r = await undoCancel(id, operatorId, { db, clock: clockAfter(0) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('no_prior_state');
  });

  it('is a no-op the second time — undo cannot be applied twice', async () => {
    const id = await cancelled('unassigned');
    const first = await undoCancel(id, operatorId, { db, clock: clockAfter(1_000) });
    const second = await undoCancel(id, operatorId, { db, clock: clockAfter(2_000) });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe('not_cancelled');
  });
});
