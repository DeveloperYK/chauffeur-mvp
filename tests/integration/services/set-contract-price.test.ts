import { FakeSpreadsheetMirror } from '@/server/adapters/spreadsheet-mirror-fake';
import { auditEvents, bookings, operators } from '@/server/db/schema';
import { setContractPrice } from '@/server/services/set-contract-price';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestDb, createTestDb } from '~test/helpers/pglite-db';

describe('services/set-contract-price (integration)', () => {
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

  async function seed(
    state: 'unassigned' | 'assigned' | 'completed' | 'cancelled',
    contractPricePence: number | null = null,
  ) {
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
        contractPricePence,
        createdByOperatorId: operatorId,
        assignedOperatorId: operatorId,
      })
      .returning();
    if (!row) throw new Error('seed failed');
    return row;
  }

  // ── Happy paths ────────────────────────────────────────────────
  it('sets the price on a completed booking that finished without one', async () => {
    const seeded = await seed('completed', null);
    const result = await setContractPrice(seeded.id, 25000, operatorId, { db });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.booking.contractPricePence).toBe(25000);
    const [row] = await db.select().from(bookings).where(eq(bookings.id, seeded.id));
    expect(row?.contractPricePence).toBe(25000);
    expect(row?.state).toBe('completed');
  });

  it('sets the price on an active (unassigned) booking', async () => {
    const seeded = await seed('unassigned', null);
    const result = await setContractPrice(seeded.id, 18000, operatorId, { db });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.booking.contractPricePence).toBe(18000);
  });

  it('corrects an already-set price and can clear it back to null', async () => {
    const seeded = await seed('assigned', 30000);
    const corrected = await setContractPrice(seeded.id, 32000, operatorId, { db });
    expect(corrected.ok).toBe(true);
    const cleared = await setContractPrice(seeded.id, null, operatorId, { db });
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(cleared.booking.contractPricePence).toBeNull();
  });

  // ── Side effects ───────────────────────────────────────────────
  it('records an audit event with before/after and mirrors the booking', async () => {
    const seeded = await seed('completed', null);
    const mirror = new FakeSpreadsheetMirror();
    const result = await setContractPrice(seeded.id, 25000, operatorId, { db, mirror });
    expect(result.ok).toBe(true);
    const events = await db.select().from(auditEvents);
    expect(events.length).toBe(1);
    expect(events[0]?.action).toBe('set_contract_price');
    // The sheet row now carries the price in column L (index 11).
    expect(mirror.rows.get(seeded.id)?.[11]).toBe('250.00');
  });

  // ── Unhappy paths ──────────────────────────────────────────────
  it('rejects a zero price (blank/null means "not agreed", zero is a mistake)', async () => {
    const seeded = await seed('completed', null);
    const result = await setContractPrice(seeded.id, 0, operatorId, { db });
    expect(result).toMatchObject({ ok: false, reason: 'validation' });
  });

  it('rejects a negative price', async () => {
    const seeded = await seed('completed', null);
    const result = await setContractPrice(seeded.id, -100, operatorId, { db });
    expect(result).toMatchObject({ ok: false, reason: 'validation' });
  });

  it('rejects a price over the £10,000 maximum', async () => {
    const seeded = await seed('completed', null);
    const result = await setContractPrice(seeded.id, 10_000_01, operatorId, { db });
    expect(result).toMatchObject({ ok: false, reason: 'validation' });
  });

  it('refuses to price a cancelled booking (never billed)', async () => {
    const seeded = await seed('cancelled', null);
    const result = await setContractPrice(seeded.id, 25000, operatorId, { db });
    expect(result).toMatchObject({ ok: false, reason: 'not_editable' });
  });

  it('returns booking_not_found for an unknown id', async () => {
    const result = await setContractPrice(
      '00000000-0000-0000-0000-000000000000',
      25000,
      operatorId,
      { db },
    );
    expect(result).toMatchObject({ ok: false, reason: 'booking_not_found' });
  });
});
