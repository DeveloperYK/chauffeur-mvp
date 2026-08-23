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
        accountCode: 'LEGO Group',
        caseCode: 'LEGO-2026-001',
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
    customerAccount: 'LEGO Group',
    caseCode: 'LEGO-2026-001',
    contractPricePence: 30000,
    notes: null,
    operatorNotes: null,
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

  it('parses a bare datetime-local pickup edit as Europe/London (BST), not server-local', async () => {
    const seeded = await seed('unassigned');
    const result = await editBooking(
      fullEdit(seeded.id, { pickupAt: '2026-07-01T10:30' }),
      operatorId,
      { db },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 10:30 London in BST is 09:30 UTC — timezone-independent, so this holds in
    // UTC CI as well as on a Europe/London dev box. Guards the +1h edit bug.
    expect(result.booking.pickupAt.toISOString()).toBe('2026-07-01T09:30:00.000Z');
    expect(result.changedFields).toContain('pickup time');
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

  it('amends the private operator notes independently of the driver-facing notes', async () => {
    const seeded = await seed('unassigned');
    const result = await editBooking(
      fullEdit(seeded.id, {
        notes: 'Meet at Costa, Terminal 5',
        operatorNotes: 'Client disputes every invoice — confirm price up front',
      }),
      operatorId,
      { db },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.booking.notes).toBe('Meet at Costa, Terminal 5');
    expect(result.booking.operatorNotes).toBe(
      'Client disputes every invoice — confirm price up front',
    );
    expect(result.changedFields).toEqual(expect.arrayContaining(['notes', 'private notes']));
  });

  it('reports private notes alone as the only changed field', async () => {
    const seeded = await seed('unassigned');
    const result = await editBooking(
      fullEdit(seeded.id, { operatorNotes: 'Cash job — no card on file' }),
      operatorId,
      { db },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.booking.operatorNotes).toBe('Cash job — no card on file');
    expect(result.changedFields).toEqual(['private notes']);
  });

  it('amends the customer account (account_code + client_name) and case code', async () => {
    const seeded = await seed('unassigned');
    const result = await editBooking(
      fullEdit(seeded.id, { customerAccount: 'Mercedes-Benz UK', caseCode: 'MERC-9' }),
      operatorId,
      { db },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.booking.accountCode).toBe('Mercedes-Benz UK');
    expect(result.booking.clientName).toBe('Mercedes-Benz UK');
    expect(result.booking.caseCode).toBe('MERC-9');
    expect(result.changedFields).toEqual(expect.arrayContaining(['customer account', 'case code']));
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

  // ── Optional pricing ───────────────────────────────────────────
  it('clears the contract price and reports it changed', async () => {
    const seeded = await seed('unassigned');
    const result = await editBooking(
      fullEdit(seeded.id, { contractPricePence: null }),
      operatorId,
      { db },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.booking.contractPricePence).toBeNull();
    expect(result.changedFields).toContain('price');
  });

  it('sets the subcontractor price and reports it changed', async () => {
    const seeded = await seed('unassigned');
    const result = await editBooking(
      fullEdit(seeded.id, { subcontractorPricePence: 12000 }),
      operatorId,
      { db },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.booking.subcontractorPricePence).toBe(12000);
    expect(result.changedFields).toContain('subcontractor price');
  });

  it('treats an omitted subcontractor price as unchanged when none is stored', async () => {
    const seeded = await seed('unassigned');
    const result = await editBooking(fullEdit(seeded.id), operatorId, { db });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changedFields).toEqual([]);
  });

  it('rejects a zero subcontractor price', async () => {
    const seeded = await seed('unassigned');
    const result = await editBooking(
      fullEdit(seeded.id, { subcontractorPricePence: 0 }),
      operatorId,
      { db },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('validation');
  });

  // ── Flight/train reference ─────────────────────────────────────
  it('adds a flight reference and reports it as a flight/train change', async () => {
    const seeded = await seed('unassigned');
    const result = await editBooking(
      fullEdit(seeded.id, { travelMode: 'flight', travelRef: 'ba 268' }),
      operatorId,
      { db },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.booking.travelMode).toBe('flight');
    expect(result.booking.travelRef).toBe('BA268');
    expect(result.changedFields).toContain('flight/train');
  });

  it('flags an assigned booking for driver re-confirmation when the flight changes', async () => {
    const seeded = await seed('assigned');
    const result = await editBooking(
      fullEdit(seeded.id, { travelMode: 'flight', travelRef: 'BA268' }),
      operatorId,
      { db },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.materialChange).toBe(true);
  });

  it('clears the travel reference when both fields are removed', async () => {
    const seeded = await seed('unassigned');
    const first = await editBooking(
      fullEdit(seeded.id, { travelMode: 'train', travelRef: '12:03 from Manchester' }),
      operatorId,
      { db },
    );
    expect(first.ok).toBe(true);
    const second = await editBooking(fullEdit(seeded.id), operatorId, { db });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.booking.travelMode).toBeNull();
    expect(second.booking.travelRef).toBeNull();
    expect(second.changedFields).toContain('flight/train');
  });

  it('rejects an invalid flight designator on edit', async () => {
    const seeded = await seed('unassigned');
    const result = await editBooking(
      fullEdit(seeded.id, { travelMode: 'flight', travelRef: 'not a flight' }),
      operatorId,
      { db },
    );
    expect(result).toMatchObject({ ok: false, reason: 'validation' });
  });
});
