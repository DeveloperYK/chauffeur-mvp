import { type BookingState, auditEvents, bookings, drivers, operators } from '@/server/db/schema';
import { editBooking } from '@/server/services/edit-booking';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestDb, createTestDb } from '~test/helpers/pglite-db';

/**
 * Covers the mid-flight change flag that editBooking sets: a driver-facing edit
 * on an already-dispatched booking flips changeConfirmationStatus to `pending`.
 * See docs/shaping/mid-flight-changes.
 */
describe('services/edit-booking — mid-flight change flag (integration)', () => {
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
        name: 'Tom',
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

  async function seed(state: BookingState, overrides: Partial<typeof bookings.$inferInsert> = {}) {
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
        createdByOperatorId: operatorId,
        assignedOperatorId: operatorId,
        assignedDriverId: state === 'unassigned' ? null : driverId,
        ...overrides,
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
    ...overrides,
  });

  it('flags pending on a driver-facing change while assigned', async () => {
    const b = await seed('assigned');
    const res = await editBooking(fullEdit(b.id, { dropoffAddress: 'Gatwick South' }), operatorId, {
      db,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.materialChange).toBe(true);

    const [row] = await db.select().from(bookings).where(eq(bookings.id, b.id));
    expect(row?.changeConfirmationStatus).toBe('pending');
    expect(row?.changePendingSince).toBeTruthy();
    // Destination is exec-facing, so the change is flagged exec-relevant.
    expect(row?.changeExecRelevant).toBe(true);
  });

  it('flags pending but NOT exec-relevant for a driver-only change (duration)', async () => {
    const b = await seed('assigned');
    const res = await editBooking(fullEdit(b.id, { expectedDurationMinutes: 150 }), operatorId, {
      db,
    });
    expect(res.ok && res.materialChange).toBe(true);
    const [row] = await db.select().from(bookings).where(eq(bookings.id, b.id));
    expect(row?.changeConfirmationStatus).toBe('pending');
    expect(row?.changeExecRelevant).toBe(false);
  });

  it('flags pending on a driver-facing change while in_progress', async () => {
    const b = await seed('in_progress');
    const res = await editBooking(
      fullEdit(b.id, { pickupAt: new Date('2026-06-01T11:00:00.000Z').toISOString() }),
      operatorId,
      { db },
    );
    expect(res.ok && res.materialChange).toBe(true);
    const [row] = await db.select().from(bookings).where(eq(bookings.id, b.id));
    expect(row?.changeConfirmationStatus).toBe('pending');
  });

  it('does NOT flag a price-only (non-material) change', async () => {
    const b = await seed('assigned');
    const res = await editBooking(fullEdit(b.id, { contractPricePence: 45000 }), operatorId, {
      db,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.materialChange).toBe(false);
    const [row] = await db.select().from(bookings).where(eq(bookings.id, b.id));
    expect(row?.changeConfirmationStatus).toBe('none');
  });

  it('does NOT flag a driver-facing change before dispatch (unassigned)', async () => {
    const b = await seed('unassigned');
    const res = await editBooking(fullEdit(b.id, { dropoffAddress: 'Gatwick South' }), operatorId, {
      db,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.materialChange).toBe(false);
    const [row] = await db.select().from(bookings).where(eq(bookings.id, b.id));
    expect(row?.changeConfirmationStatus).toBe('none');
  });

  it('a fresh material change supersedes a prior confirmation (back to pending)', async () => {
    const b = await seed('assigned', {
      changeConfirmationStatus: 'confirmed',
      changeConfirmedMethod: 'operator_attested',
      changeConfirmedByOperatorId: operatorId,
      changeConfirmedAt: new Date('2026-05-30T09:00:00.000Z'),
    });
    const res = await editBooking(
      fullEdit(b.id, { pickupAddress: 'New Pickup, London' }),
      operatorId,
      {
        db,
      },
    );
    expect(res.ok && res.materialChange).toBe(true);
    const [row] = await db.select().from(bookings).where(eq(bookings.id, b.id));
    expect(row?.changeConfirmationStatus).toBe('pending');
    expect(row?.changeConfirmedMethod).toBeNull();
    expect(row?.changeConfirmedByOperatorId).toBeNull();
    expect(row?.changeConfirmedAt).toBeNull();
  });
});
