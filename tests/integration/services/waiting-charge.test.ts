import { FakeSpreadsheetMirror } from '@/server/adapters/spreadsheet-mirror-fake';
import { auditEvents, bookings, operators } from '@/server/db/schema';
import type { SpreadsheetMirrorPort } from '@/server/ports/spreadsheet-mirror';
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

  // ── Side effects: the backup sheet must mirror the app exactly ──────────
  // 2026-10-18: an operator edited the waiting fee on a completed booking and
  // the sheet kept the old figure, because this service never mirrored.
  const WAITING_COL = 19; // T  Waiting (£)
  const TOTAL_COL = 20; // U  Total (£)

  it('mirrors an override to the sheet: Waiting (£) and Total (£) change', async () => {
    const booking = await seed(5);
    const mirror = new FakeSpreadsheetMirror();
    const r = await setWaitingCharge(booking.id, 1250, operatorId, { db, mirror });
    expect(r.ok).toBe(true);
    const row = mirror.rows.get(booking.id);
    expect(row?.[WAITING_COL]).toBe('12.50');
    expect(row?.[TOTAL_COL]).toBe('312.50');
  });

  it('mirrors a cleared override back to the computed £1/min charge', async () => {
    const booking = await seed(5);
    const mirror = new FakeSpreadsheetMirror();
    await setWaitingCharge(booking.id, 1250, operatorId, { db, mirror });
    const r = await setWaitingCharge(booking.id, null, operatorId, { db, mirror });
    expect(r.ok).toBe(true);
    const row = mirror.rows.get(booking.id);
    expect(row?.[WAITING_COL]).toBe('5.00');
    expect(row?.[TOTAL_COL]).toBe('305.00');
  });

  it('mirrors a £0 waiver', async () => {
    const booking = await seed(5);
    const mirror = new FakeSpreadsheetMirror();
    await setWaitingCharge(booking.id, 0, operatorId, { db, mirror });
    expect(mirror.rows.get(booking.id)?.[WAITING_COL]).toBe('0.00');
  });

  it('records mirror_status on the booking so a stale sheet is visible', async () => {
    const booking = await seed(5);
    const mirror = new FakeSpreadsheetMirror();
    await setWaitingCharge(booking.id, 300, operatorId, { db, mirror });
    const [after] = await db.select().from(bookings);
    expect(after?.mirrorStatus).toBe('ok');
  });

  it('still saves the charge when the mirror fails, and flags the row as stale', async () => {
    const booking = await seed(5);
    const failing: SpreadsheetMirrorPort = {
      upsertRow: async () => ({ ok: false, reason: 'sheets down' }),
      deleteRow: async () => ({ ok: false, reason: 'sheets down' }),
    };
    const r = await setWaitingCharge(booking.id, 300, operatorId, { db, mirror: failing });
    expect(r.ok).toBe(true);
    const [after] = await db.select().from(bookings);
    expect(after?.waitingChargePence).toBe(300);
    expect(after?.mirrorStatus).toBe('failed');
  });

  it('does not touch the sheet for a rejected charge', async () => {
    const booking = await seed(5);
    const mirror = new FakeSpreadsheetMirror();
    await setWaitingCharge(booking.id, -1, operatorId, { db, mirror });
    expect(mirror.rows.has(booking.id)).toBe(false);
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
