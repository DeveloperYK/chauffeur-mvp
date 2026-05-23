import { FakeSpreadsheetMirror } from '@/server/adapters/spreadsheet-mirror-fake';
import { auditEvents, bookings, drivers, operators } from '@/server/db/schema';
import { editBooking } from '@/server/services/edit-booking';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestDb, createTestDb } from '~test/helpers/pglite-db';

describe('services/edit-booking (integration)', () => {
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
    const [drv] = await db
      .insert(drivers)
      .values({
        name: 'Tom Premium',
        tier: 'premium',
        defaultCarType: 'Mercedes S-Class',
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
  });

  async function seed(state: 'unassigned' | 'assigned' | 'completed' | 'cancelled') {
    const [row] = await db
      .insert(bookings)
      .values({
        state,
        pickupAt: new Date('2026-06-01T10:00:00.000Z'),
        expectedDurationMinutes: 90,
        pickupAddress: '11 Belsize Park Gardens, London',
        dropoffAddress: 'LHR Terminal 5',
        passengerFirstName: 'Eric',
        passengerLastName: 'French',
        execMobile: '+447911123456',
        clientName: 'LEGO Group',
        accountCode: 'LEGO',
        contractPricePence: 30000,
        notes: null,
        createdByOperatorId: operatorId,
        assignedOperatorId: operatorId,
        assignedDriverId: state === 'assigned' ? driverId : null,
      })
      .returning();
    if (!row) throw new Error('seed failed');
    return row;
  }

  const fullEdit = (bookingId: string, overrides: Record<string, unknown> = {}) => ({
    bookingId,
    pickupAt: new Date('2026-06-01T10:00:00.000Z').toISOString(),
    expectedDurationMinutes: 90,
    pickupAddress: '11 Belsize Park Gardens, London',
    dropoffAddress: 'LHR Terminal 5',
    passengerFirstName: 'Eric',
    passengerLastName: 'French',
    execMobile: '+447911123456',
    clientName: 'LEGO Group',
    accountCode: 'LEGO',
    contractPricePence: 30000,
    notes: null,
    ...overrides,
  });

  // ── Happy paths ────────────────────────────────────────────────
  it('amends a field and reports the changed field', async () => {
    const seeded = await seed('unassigned');
    const result = await editBooking(
      fullEdit(seeded.id, { contractPricePence: 35000 }),
      operatorId,
      { db },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.booking.contractPricePence).toBe(35000);
    expect(result.changedFields).toContain('price');
  });

  it('amends multiple fields at once', async () => {
    const seeded = await seed('unassigned');
    const result = await editBooking(
      fullEdit(seeded.id, {
        pickupAddress: 'The Connaught, Mayfair',
        notes: 'Two large suitcases',
      }),
      operatorId,
      { db },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.booking.pickupAddress).toBe('The Connaught, Mayfair');
    expect(result.booking.notes).toBe('Two large suitcases');
    expect(result.changedFields).toEqual(expect.arrayContaining(['pickup address', 'notes']));
  });

  it('is permitted on an assigned booking (pre-completion)', async () => {
    const seeded = await seed('assigned');
    const result = await editBooking(
      fullEdit(seeded.id, { dropoffAddress: 'Gatwick North' }),
      operatorId,
      { db },
    );
    expect(result.ok).toBe(true);
  });

  it('writes an audit event listing the changed fields', async () => {
    const seeded = await seed('unassigned');
    await editBooking(fullEdit(seeded.id, { contractPricePence: 40000 }), operatorId, { db });
    const events = await db.select().from(auditEvents);
    expect(events.length).toBe(1);
    expect(events[0]?.action).toBe('edit');
    expect(events[0]?.actorId).toBe(operatorId);
  });

  it('mirrors the updated booking when a mirror is supplied', async () => {
    const seeded = await seed('unassigned');
    const mirror = new FakeSpreadsheetMirror();
    await editBooking(fullEdit(seeded.id, { notes: 'Quiet driver' }), operatorId, { db, mirror });
    expect(mirror.rows.size).toBeGreaterThan(0);
  });

  // ── Unhappy paths ──────────────────────────────────────────────
  it('returns booking_not_found for an unknown id', async () => {
    const result = await editBooking(fullEdit('00000000-0000-0000-0000-000000000000'), operatorId, {
      db,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('booking_not_found');
  });

  it('refuses to edit a completed booking', async () => {
    const seeded = await seed('completed');
    const result = await editBooking(fullEdit(seeded.id, { notes: 'too late' }), operatorId, {
      db,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not_editable');
  });

  it('refuses to edit a cancelled booking', async () => {
    const seeded = await seed('cancelled');
    const result = await editBooking(fullEdit(seeded.id), operatorId, { db });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not_editable');
  });

  it('rejects an invalid phone number', async () => {
    const seeded = await seed('unassigned');
    const result = await editBooking(
      fullEdit(seeded.id, { execMobile: 'not-a-phone' }),
      operatorId,
      { db },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('validation');
  });

  it('rejects a too-short pickup address', async () => {
    const seeded = await seed('unassigned');
    const result = await editBooking(fullEdit(seeded.id, { pickupAddress: 'x' }), operatorId, {
      db,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('validation');
  });

  it('returns no changed fields and an unchanged booking when nothing differs', async () => {
    const seeded = await seed('unassigned');
    const result = await editBooking(fullEdit(seeded.id), operatorId, { db });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changedFields).toEqual([]);
    // No audit event when nothing changed.
    const events = await db.select().from(auditEvents);
    expect(events.length).toBe(0);
  });
});
