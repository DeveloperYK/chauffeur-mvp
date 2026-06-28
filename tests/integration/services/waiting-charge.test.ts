import { auditEvents, bookings, operators } from '@/server/db/schema';
import { setWaitingCharge } from '@/server/services/waiting-charge';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestDb, createTestDb } from '~test/helpers/pglite-db';

describe('services/setWaitingCharge (integration)', () => {
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

  async function seed(waitingTimeMinutes: number | null = 5) {
    const [row] = await db
      .insert(bookings)
      .values({
        state: 'completed',
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
        waitingTimeMinutes,
      })
      .returning();
    if (!row) throw new Error('seed failed');
    return row;
  }

  it('pins an override charge and records an audit event', async () => {
    const booking = await seed(5);
    const r = await setWaitingCharge(booking.id, 300, operatorId, { db });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.booking.waitingChargePence).toBe(300);

    const event = (await db.select().from(auditEvents)).find(
      (e) => e.action === 'set_waiting_charge',
    );
    expect(event?.actorType).toBe('operator');
    expect(event?.actorId).toBe(operatorId);
    expect((event?.after as { waitingChargePence: number }).waitingChargePence).toBe(300);
  });

  it('clears the override (null) so the charge falls back to the computed £1/min', async () => {
    const booking = await seed(5);
    await setWaitingCharge(booking.id, 300, operatorId, { db });
    const r = await setWaitingCharge(booking.id, null, operatorId, { db });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.booking.waitingChargePence).toBeNull();
  });

  it('accepts an explicit £0 override (goodwill waiver)', async () => {
    const booking = await seed(5);
    const r = await setWaitingCharge(booking.id, 0, operatorId, { db });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.booking.waitingChargePence).toBe(0);
  });

  it('rejects a negative charge', async () => {
    const booking = await seed(5);
    const r = await setWaitingCharge(booking.id, -1, operatorId, { db });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('validation');
  });

  it('rejects a charge above the £10,000 ceiling', async () => {
    const booking = await seed(5);
    const r = await setWaitingCharge(booking.id, 1_000_01, operatorId, { db });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('validation');
  });

  it('rejects a missing booking', async () => {
    const r = await setWaitingCharge('00000000-0000-0000-0000-000000000000', 300, operatorId, {
      db,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('booking_not_found');
  });
});
