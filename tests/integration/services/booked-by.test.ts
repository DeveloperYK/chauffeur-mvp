import { auditEvents, bookings, operators } from '@/server/db/schema';
import { fixedClock } from '@/server/ports/clock';
import { createBooking } from '@/server/services/bookings';
import { editBooking } from '@/server/services/edit-booking';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestDb, createTestDb } from '~test/helpers/pglite-db';

/**
 * "Booked by" — the PA who booked on the exec's behalf. Optional as a whole,
 * but a partially-filled section is rejected: a name needs at least one
 * contact (phone or email), and a contact needs a name.
 */
describe('services/bookings booked-by (integration)', () => {
  let db: TestDb;
  let close: () => Promise<void>;
  let operatorId: string;

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
    await db.delete(bookings);
    await db.delete(auditEvents);
  });

  const clock = fixedClock('2026-05-18T10:00:00.000Z');

  const validInput = (overrides: Record<string, unknown> = {}) => ({
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
    ...overrides,
  });

  // ── Happy paths ────────────────────────────────────────────────

  it('stores name + phone + email, normalising the phone to E.164', async () => {
    const result = await createBooking(
      validInput({
        bookedByName: 'Sandra Miles',
        bookedByPhone: '07911 123457',
        bookedByEmail: 'sandra.miles@legogroup.com',
      }),
      { db, clock, operatorId },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.booking.bookedByName).toBe('Sandra Miles');
    expect(result.booking.bookedByPhone).toBe('+447911123457');
    expect(result.booking.bookedByEmail).toBe('sandra.miles@legogroup.com');
  });

  it('accepts a name with only an email', async () => {
    const result = await createBooking(
      validInput({ bookedByName: 'Sandra Miles', bookedByEmail: 'sandra@legogroup.com' }),
      { db, clock, operatorId },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.booking.bookedByEmail).toBe('sandra@legogroup.com');
    expect(result.booking.bookedByPhone).toBeNull();
  });

  it('accepts a name with only a phone', async () => {
    const result = await createBooking(
      validInput({ bookedByName: 'Sandra Miles', bookedByPhone: '07911 123457' }),
      { db, clock, operatorId },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.booking.bookedByPhone).toBe('+447911123457');
    expect(result.booking.bookedByEmail).toBeNull();
  });

  it('leaves all booked-by fields null when the section is omitted entirely', async () => {
    const result = await createBooking(validInput(), { db, clock, operatorId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.booking.bookedByName).toBeNull();
    expect(result.booking.bookedByPhone).toBeNull();
    expect(result.booking.bookedByEmail).toBeNull();
  });

  // ── Unhappy paths ──────────────────────────────────────────────

  it('rejects a booked-by name with no contact at all', async () => {
    const result = await createBooking(validInput({ bookedByName: 'Sandra Miles' }), {
      db,
      clock,
      operatorId,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('validation');
  });

  it('rejects a booked-by contact with no name', async () => {
    const result = await createBooking(validInput({ bookedByEmail: 'sandra@legogroup.com' }), {
      db,
      clock,
      operatorId,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('validation');
  });

  it('rejects an invalid booked-by email', async () => {
    const result = await createBooking(
      validInput({ bookedByName: 'Sandra Miles', bookedByEmail: 'not-an-email' }),
      { db, clock, operatorId },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('validation');
  });

  it('rejects an invalid booked-by phone', async () => {
    const result = await createBooking(
      validInput({ bookedByName: 'Sandra Miles', bookedByPhone: '12' }),
      { db, clock, operatorId },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('validation');
  });

  // ── Editing ────────────────────────────────────────────────────

  async function seedAssigned() {
    const created = await createBooking(validInput(), { db, clock, operatorId });
    if (!created.ok) throw new Error('seed failed');
    const [row] = await db
      .update(bookings)
      .set({ state: 'assigned' })
      .where(eq(bookings.id, created.booking.id))
      .returning();
    return row ?? created.booking;
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

  it('adding booked-by via edit reports "booked by" and is not a material change', async () => {
    const seeded = await seedAssigned();
    const result = await editBooking(
      fullEdit(seeded.id, { bookedByName: 'Sandra Miles', bookedByPhone: '07911 123457' }),
      operatorId,
      { db },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changedFields).toEqual(['booked by']);
    // A PA-details edit never flags the booking for driver re-confirmation.
    expect(result.materialChange).toBe(false);
    expect(result.booking.bookedByPhone).toBe('+447911123457');
  });

  it('clearing booked-by via edit stores nulls and reports "booked by"', async () => {
    const created = await createBooking(
      validInput({ bookedByName: 'Sandra Miles', bookedByEmail: 'sandra@legogroup.com' }),
      { db, clock, operatorId },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const result = await editBooking(fullEdit(created.booking.id), operatorId, { db });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changedFields).toEqual(['booked by']);
    expect(result.booking.bookedByName).toBeNull();
    expect(result.booking.bookedByEmail).toBeNull();
  });

  it('rejects a partially-filled booked-by section on edit too', async () => {
    const created = await createBooking(validInput(), { db, clock, operatorId });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const result = await editBooking(
      fullEdit(created.booking.id, { bookedByName: 'Sandra Miles' }),
      operatorId,
      { db },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('validation');
  });
});
