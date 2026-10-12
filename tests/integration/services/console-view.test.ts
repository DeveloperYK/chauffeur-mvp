import { bookings, dispatchOffers, operators } from '@/server/db/schema';
import { toConsoleBooking } from '@/server/services/console-view';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestDb, createTestDb } from '~test/helpers/pglite-db';

/**
 * The board's read model: a booking row serialised for the client console.
 */
describe('services/console-view (integration)', () => {
  let db: TestDb;
  let close: () => Promise<void>;
  let operatorId: string;

  beforeAll(async () => {
    const t = await createTestDb();
    db = t.db;
    close = t.close;
    const [op] = await db
      .insert(operators)
      .values({ email: 'op@example.com', passwordHash: 'x', name: 'Op One' })
      .returning();
    operatorId = op?.id ?? '';
  });

  afterAll(async () => {
    await close();
  });

  beforeEach(async () => {
    await db.delete(dispatchOffers);
    await db.delete(bookings);
  });

  async function seed(pickupAt: Date, overrides: Partial<typeof bookings.$inferInsert> = {}) {
    const [row] = await db
      .insert(bookings)
      .values({
        state: 'unassigned',
        expectedDurationMinutes: 90,
        pickupAddress: '11 Belsize Park Gardens, London NW3 4JJ',
        dropoffAddress: 'Heathrow T5',
        passengerFirstName: 'Eric',
        passengerLastName: 'French',
        execMobile: '+447911123456',
        clientName: 'LEGO Group',
        accountCode: 'LEGO Group',
        caseCode: 'LEGO-2026-001',
        contractPricePence: 30000,
        pickupAt,
        createdByOperatorId: operatorId,
        ...overrides,
      })
      .returning();
    if (!row) throw new Error('seed failed');
    return row;
  }

  describe('toConsoleBooking', () => {
    it('serialises dates to ISO strings and derives the waiting fee', async () => {
      const row = await seed(new Date('2026-10-13T09:00:00Z'), { waitingTimeMinutes: 25 });
      const c = toConsoleBooking(row);
      expect(c.pickupAt).toBe('2026-10-13T09:00:00.000Z');
      expect(c.dropoffAddress).toBe('Heathrow T5');
      expect(c.waitingFee.chargeableMinutes).toBeGreaterThan(0);
      expect(c.openOffers).toEqual([]);
      expect(c.confirmationEmailSentAt).toBeNull();
    });
    it('turns a null drop-off (hourly hire) into an empty string', async () => {
      const row = await seed(new Date('2026-10-13T09:00:00Z'), {
        serviceType: 'hourly',
        dropoffAddress: null,
      });
      expect(toConsoleBooking(row).dropoffAddress).toBe('');
    });
  });
});
