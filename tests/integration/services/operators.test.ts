import { auditEvents, bookings, operators } from '@/server/db/schema';
import { fixedClock } from '@/server/ports/clock';
import { createBooking } from '@/server/services/bookings';
import { assignOperator, listOperators, operatorsById } from '@/server/services/operators';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestDb, createTestDb } from '~test/helpers/pglite-db';

describe('services/operators (integration)', () => {
  let db: TestDb;
  let close: () => Promise<void>;
  let alice: string;
  let bob: string;

  beforeAll(async () => {
    const t = await createTestDb();
    db = t.db;
    close = t.close;
  });

  afterAll(async () => {
    await close();
  });

  beforeEach(async () => {
    await db.delete(auditEvents);
    await db.delete(bookings);
    await db.delete(operators);
    const [a] = await db
      .insert(operators)
      .values({ email: 'alice@example.com', passwordHash: 'x', name: 'Alice' })
      .returning();
    const [b] = await db
      .insert(operators)
      .values({ email: 'bob@example.com', passwordHash: 'x', name: 'Bob' })
      .returning();
    alice = a?.id ?? '';
    bob = b?.id ?? '';
  });

  const validInput = () => ({
    pickupAt: new Date('2026-06-01T10:00:00.000Z').toISOString(),
    expectedDurationMinutes: 90,
    pickupAddress: '11 Belsize Park Gardens',
    dropoffAddress: 'LHR Terminal 5',
    passengerFirstName: 'Eric',
    passengerLastName: 'French',
    execMobile: '+447911123456',
    clientName: 'LEGO Group',
    accountCode: 'LEGO',
    contractPricePence: 30000,
    notes: null,
  });

  const clock = fixedClock('2026-05-20T10:00:00.000Z');

  it('listOperators returns active operators name-sorted', async () => {
    const ops = await listOperators(db);
    expect(ops.map((o) => o.name)).toEqual(['Alice', 'Bob']);
  });

  it('listOperators excludes inactive operators', async () => {
    await db.update(operators).set({ active: false }).where(eq(operators.id, bob));
    const ops = await listOperators(db);
    expect(ops.map((o) => o.name)).toEqual(['Alice']);
  });

  it('createBooking sets created-by and assigned operator to the creator', async () => {
    const r = await createBooking(validInput(), { db, clock, operatorId: alice });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.booking.createdByOperatorId).toBe(alice);
    expect(r.booking.assignedOperatorId).toBe(alice);
  });

  it('assignOperator reassigns and writes an audit event', async () => {
    const created = await createBooking(validInput(), { db, clock, operatorId: alice });
    if (!created.ok) throw new Error('setup');
    const r = await assignOperator(created.booking.id, bob, alice, { db });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.booking.assignedOperatorId).toBe(bob);

    const events = await db.select().from(auditEvents);
    const assign = events.find((e) => e.action === 'assign_operator');
    expect(assign).toBeDefined();
    const before = assign?.before as { assignedOperatorId: string };
    const after = assign?.after as { assignedOperatorId: string };
    expect(before.assignedOperatorId).toBe(alice);
    expect(after.assignedOperatorId).toBe(bob);
  });

  it('assignOperator can unassign with null', async () => {
    const created = await createBooking(validInput(), { db, clock, operatorId: alice });
    if (!created.ok) throw new Error('setup');
    const r = await assignOperator(created.booking.id, null, alice, { db });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.booking.assignedOperatorId).toBeNull();
  });

  it('assignOperator rejects unknown booking', async () => {
    const r = await assignOperator('00000000-0000-0000-0000-000000000099', bob, alice, { db });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('booking_not_found');
  });

  it('assignOperator rejects unknown target operator', async () => {
    const created = await createBooking(validInput(), { db, clock, operatorId: alice });
    if (!created.ok) throw new Error('setup');
    const r = await assignOperator(
      created.booking.id,
      '00000000-0000-0000-0000-000000000099',
      alice,
      { db },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('operator_not_found');
  });

  it('operatorsById returns name/email map for given ids', async () => {
    const map = await operatorsById(db, [alice, bob, alice]);
    expect(map.size).toBe(2);
    expect(map.get(alice)?.name).toBe('Alice');
    expect(map.get(bob)?.email).toBe('bob@example.com');
  });
});
