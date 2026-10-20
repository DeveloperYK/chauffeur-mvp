import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bookings, drivers, operators } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SeedData } from '~test/fixtures/seed-data';
import { type TestDb, createTestDb } from '~test/helpers/pglite-db';

/**
 * Migration 0038 folds the retired backfill flow into the roster: every
 * booking that was covered by a free-text subcontractor becomes a booking
 * assigned to a (new or existing) driver row, so history keeps its driver
 * once the code stops reading the backfill columns. The legacy columns stay
 * in place (unread) for rollback. The SQL is idempotent — the template DB
 * has already run it once, and this test runs it again on fresh rows.
 */
describe('migration 0038: backfill bookings become driver assignments', () => {
  let db: TestDb;
  let client: Awaited<ReturnType<typeof createTestDb>>['client'];
  let close: () => Promise<void>;
  let operatorId: string;
  const migrationSql = readFileSync(
    join(process.cwd(), 'drizzle', '0038_backfill_to_drivers.sql'),
    'utf8',
  );

  beforeAll(async () => {
    const t = await createTestDb();
    db = t.db;
    client = t.client;
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
    await db.delete(drivers);
  });

  async function seedLegacyBackfill(opts: {
    name: string;
    phone: string;
    car?: string | null;
    payPence?: number | null;
    state?: 'assigned' | 'completed';
  }): Promise<string> {
    const [b] = await db
      .insert(bookings)
      .values({
        ...SeedData.bookings.unassigned(operatorId),
        state: opts.state ?? 'completed',
        assignedAt: new Date('2026-06-01T09:00:00Z'),
      })
      .returning({ id: bookings.id });
    if (!b) throw new Error('seed failed');
    await client.query(
      `update bookings set is_backfill = true, backfill_driver_name = $1,
         backfill_driver_phone = $2, backfill_car = $3, backfill_driver_pay_pence = $4
       where id = $5`,
      [opts.name, opts.phone, opts.car ?? null, opts.payPence ?? null, b.id],
    );
    return b.id;
  }

  async function runMigration() {
    await client.exec(migrationSql);
  }

  it('creates one inactive driver per subcontractor phone and links every booking to it', async () => {
    const a = await seedLegacyBackfill({
      name: 'Dave Smith',
      phone: '+447911123456',
      car: 'BMW 5',
    });
    const b = await seedLegacyBackfill({ name: 'Dave Smith', phone: '+447911123456' });
    const c = await seedLegacyBackfill({ name: 'Sub Sam', phone: '+447900000777', car: 'Audi A6' });
    await runMigration();

    const roster = await db.select().from(drivers).orderBy(drivers.name);
    expect(roster.map((d) => [d.name, d.whatsappNumber, d.car, d.active])).toEqual([
      ['Dave Smith', '+447911123456', 'BMW 5', false],
      ['Sub Sam', '+447900000777', 'Audi A6', false],
    ]);
    const dave = roster.find((d) => d.name === 'Dave Smith');
    const sam = roster.find((d) => d.name === 'Sub Sam');
    const rows = await db.select().from(bookings);
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(a)?.assignedDriverId).toBe(dave?.id);
    expect(byId.get(b)?.assignedDriverId).toBe(dave?.id);
    expect(byId.get(c)?.assignedDriverId).toBe(sam?.id);
    expect(byId.get(a)?.assignmentMethod).toBe('operator_attested');
  });

  it('reuses an existing roster driver with the same WhatsApp number', async () => {
    const [existing] = await db
      .insert(drivers)
      .values({ ...SeedData.drivers.premiumTom(), whatsappNumber: '+447911123456' })
      .returning();
    const id = await seedLegacyBackfill({ name: 'Dave Smith', phone: '+447911123456' });
    await runMigration();

    expect((await db.select().from(drivers)).length).toBe(1);
    const [row] = await db.select().from(bookings).where(eq(bookings.id, id));
    expect(row?.assignedDriverId).toBe(existing?.id);
  });

  it('carries the subcontractor pay into the subcontractor price when none was recorded', async () => {
    const paid = await seedLegacyBackfill({ name: 'A', phone: '+447911000001', payPence: 12000 });
    const quoted = await seedLegacyBackfill({ name: 'B', phone: '+447911000002', payPence: 12000 });
    await client.query('update bookings set subcontractor_price_pence = 25000 where id = $1', [
      quoted,
    ]);
    await runMigration();

    const rows = await db.select().from(bookings);
    expect(rows.find((r) => r.id === paid)?.subcontractorPricePence).toBe(12000);
    expect(rows.find((r) => r.id === quoted)?.subcontractorPricePence).toBe(25000);
  });

  it('is idempotent: a second run changes nothing', async () => {
    await seedLegacyBackfill({ name: 'Dave Smith', phone: '+447911123456' });
    await runMigration();
    const before = await db.select().from(bookings);
    await runMigration();
    expect(await db.select().from(bookings)).toEqual(before);
    expect((await db.select().from(drivers)).length).toBe(1);
  });

  it('leaves non-backfill bookings alone', async () => {
    const [plain] = await db
      .insert(bookings)
      .values(SeedData.bookings.unassigned(operatorId))
      .returning({ id: bookings.id });
    await runMigration();
    const [row] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, plain?.id ?? ''));
    expect(row?.assignedDriverId).toBeNull();
    expect((await db.select().from(drivers)).length).toBe(0);
  });
});
