import { type Booking, bookings, operators } from '@/server/db/schema';
import { listAccountCodeSuggestions } from '@/server/services/bookings-query';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestDb, createTestDb } from '~test/helpers/pglite-db';

/**
 * Customer-account autocomplete source. Suggests distinct account strings used
 * in the target (pickup) month plus the recent lookback window, target-month
 * accounts first. Keeps invoicing consistent by letting operators reuse an
 * existing spelling instead of retyping (e.g. "lego group" → "LEGO Group").
 */
describe('services/bookings-query listAccountCodeSuggestions (integration)', () => {
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

  function seed(account: string, pickupAt: Date, overrides: Partial<Booking> = {}) {
    return db.insert(bookings).values({
      state: 'unassigned',
      expectedDurationMinutes: 90,
      pickupAddress: 'A',
      dropoffAddress: 'B',
      passengerFirstName: 'Eric',
      passengerLastName: 'French',
      execMobile: '+447911123456',
      clientName: account,
      accountCode: account,
      caseCode: 'C-1',
      contractPricePence: 30000,
      pickupAt,
      createdByOperatorId: operatorId,
      ...overrides,
    });
  }

  it('suggests target-month accounts first, then recent ones, with month labels', async () => {
    await seed('LEGO Group', new Date('2026-06-10T09:00:00.000Z')); // target month
    await seed('LEGO Group', new Date('2026-06-02T09:00:00.000Z')); // dup — collapses
    await seed('Bellini & Co', new Date('2026-04-15T09:00:00.000Z')); // recent (within lookback)

    const out = await listAccountCodeSuggestions(db, '2026-06');

    expect(out.map((s) => s.account)).toEqual(['LEGO Group', 'Bellini & Co']);
    expect(out[0]).toMatchObject({ account: 'LEGO Group', inMonth: true, monthLabel: 'Jun' });
    expect(out[1]).toMatchObject({ account: 'Bellini & Co', inMonth: false, monthLabel: 'Apr' });
  });

  it('includes every booking state, not just completed', async () => {
    await seed('Acme Cancelled', new Date('2026-06-05T09:00:00.000Z'), { state: 'cancelled' });
    await seed('Acme Assigned', new Date('2026-06-06T09:00:00.000Z'), { state: 'assigned' });

    const accounts = (await listAccountCodeSuggestions(db, '2026-06')).map((s) => s.account);
    expect(accounts).toContain('Acme Cancelled');
    expect(accounts).toContain('Acme Assigned');
  });

  it('excludes accounts used only outside the lookback window or in a later month', async () => {
    await seed('Too Old', new Date('2026-02-20T12:00:00.000Z')); // before the 3-month lookback
    await seed('Next Month', new Date('2026-07-05T09:00:00.000Z')); // after the target month

    const out = await listAccountCodeSuggestions(db, '2026-06');
    expect(out).toEqual([]);
  });

  it('returns [] for an invalid month string', async () => {
    await seed('LEGO Group', new Date('2026-06-10T09:00:00.000Z'));
    expect(await listAccountCodeSuggestions(db, 'nonsense')).toEqual([]);
    expect(await listAccountCodeSuggestions(db, '2026-13')).toEqual([]);
  });

  it('returns [] when nothing falls in the window', async () => {
    expect(await listAccountCodeSuggestions(db, '2026-06')).toEqual([]);
  });
});
