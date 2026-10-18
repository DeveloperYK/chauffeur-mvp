import { bookings, operators } from '@/server/db/schema';
import { loadBookingTemplate } from '@/server/services/booking-template';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestDb, createTestDb } from '~test/helpers/pglite-db';

describe('services/loadBookingTemplate (integration)', () => {
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
  });

  async function seed(overrides: Partial<typeof bookings.$inferInsert> = {}) {
    const [row] = await db
      .insert(bookings)
      .values({
        state: 'completed',
        pickupAt: new Date('2026-06-01T10:00:00.000Z'),
        expectedDurationMinutes: 90,
        pickupAddress: '11 Belsize Park Gardens, London NW3 4AB',
        dropoffAddress: 'LHR Terminal 5',
        passengerFirstName: 'Eric',
        passengerLastName: 'French',
        execMobile: '+447911123456',
        bookedByName: 'Anna PA',
        bookedByEmail: 'anna@lego.com',
        clientName: 'LEGO Group',
        accountCode: 'LEGO Group',
        caseCode: 'LEGO-2026-001',
        contractPricePence: 30000,
        createdByOperatorId: operatorId,
        assignedOperatorId: operatorId,
        waitingTimeMinutes: 12,
        carParkPence: 800,
        ...overrides,
      })
      .returning();
    if (!row) throw new Error('seed failed');
    return row;
  }

  it('returns the reusable fields of a completed booking with its reference', async () => {
    const b = await seed();
    const r = await loadBookingTemplate(db, b.id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ref).toBe('BKNG-00001');
    expect(r.template).toMatchObject({
      passengerFirstName: 'Eric',
      passengerLastName: 'French',
      bookedByName: 'Anna PA',
      bookedByEmail: 'anna@lego.com',
      customerAccount: 'LEGO Group',
      caseCode: 'LEGO-2026-001',
      contractPricePounds: '300',
      pickupAddress: '11 Belsize Park Gardens, London NW3 4AB',
      dropoffAddress: 'LHR Terminal 5',
    });
  });

  it('works for a cancelled booking too (the job details are still reusable)', async () => {
    const b = await seed({ state: 'cancelled', cancelledAt: new Date() });
    const r = await loadBookingTemplate(db, b.id);
    expect(r.ok).toBe(true);
  });

  it('maps an hourly booking to an empty drop-off', async () => {
    const b = await seed({ serviceType: 'hourly', dropoffAddress: null });
    const r = await loadBookingTemplate(db, b.id);
    expect(r.ok && r.template.dropoffAddress).toBe('');
  });

  it('reports a missing booking', async () => {
    const r = await loadBookingTemplate(db, '00000000-0000-0000-0000-000000000000');
    expect(r).toEqual({ ok: false, reason: 'booking_not_found' });
  });

  it('rejects a malformed id without hitting the database', async () => {
    const r = await loadBookingTemplate(db, 'not-a-uuid');
    expect(r).toEqual({ ok: false, reason: 'booking_not_found' });
  });
});
