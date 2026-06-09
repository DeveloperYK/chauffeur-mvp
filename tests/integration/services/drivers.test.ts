import { auditEvents, drivers, operators } from '@/server/db/schema';
import {
  createDriver,
  deactivateDriver,
  findDriverByWhatsapp,
  getDriver,
  listActiveDrivers,
  listAllDrivers,
  updateDriver,
} from '@/server/services/drivers';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestDb, createTestDb } from '~test/helpers/pglite-db';

describe('services/drivers (integration)', () => {
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
    await db.delete(drivers);
    await db.delete(auditEvents);
  });

  const valid = (overrides: Record<string, unknown> = {}) => ({
    name: 'Tom Smith',
    vehicleClass: 'executive',
    car: 'Mercedes S-Class',
    carColour: 'Black',
    whatsappNumber: '+447911000001',
    ...overrides,
  });

  it('creates a driver and writes an audit event', async () => {
    const result = await createDriver(valid(), { db, operatorId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.driver.vehicleClass).toBe('executive');
    expect(result.driver.car).toBe('Mercedes S-Class');
    expect(result.driver.carColour).toBe('Black');
    expect(result.driver.active).toBe(true);

    const events = await db.select().from(auditEvents);
    expect(events.length).toBe(1);
    expect(events[0]?.action).toBe('create');
  });

  it('rejects invalid vehicle class', async () => {
    const result = await createDriver(valid({ vehicleClass: 'platinum' }), { db, operatorId });
    expect(result.ok).toBe(false);
  });

  it('rejects invalid phone', async () => {
    const result = await createDriver(valid({ whatsappNumber: 'nope' }), { db, operatorId });
    expect(result.ok).toBe(false);
  });

  it('rejects short name', async () => {
    const result = await createDriver(valid({ name: 'A' }), { db, operatorId });
    expect(result.ok).toBe(false);
  });

  it('rejects unknown extra fields', async () => {
    const result = await createDriver(valid({ pet: 'cat' }), { db, operatorId });
    expect(result.ok).toBe(false);
  });

  it('rejects duplicate whatsappNumber', async () => {
    await createDriver(valid(), { db, operatorId });
    const dup = await createDriver(valid({ name: 'Other' }), { db, operatorId });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.reason).toBe('duplicate_whatsapp');
  });

  it('updates a driver and writes update audit event', async () => {
    const created = await createDriver(valid(), { db, operatorId });
    if (!created.ok) throw new Error('setup');
    const updated = await updateDriver(
      created.driver.id,
      { name: 'Renamed', vehicleClass: 'luxury' },
      { db, operatorId },
    );
    expect(updated.ok).toBe(true);
    if (updated.ok) {
      expect(updated.driver.name).toBe('Renamed');
      expect(updated.driver.vehicleClass).toBe('luxury');
    }
    const events = await db.select().from(auditEvents);
    const updateEvents = events.filter((e) => e.action === 'update');
    expect(updateEvents.length).toBe(1);
    const before = updateEvents[0]?.before as { name: string };
    const after = updateEvents[0]?.after as { name: string };
    expect(before.name).toBe('Tom Smith');
    expect(after.name).toBe('Renamed');
  });

  it('update returns not_found for unknown id', async () => {
    const r = await updateDriver(
      '00000000-0000-0000-0000-000000000001',
      { name: 'A valid name' },
      { db, operatorId },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('not_found');
  });

  it('update rejects duplicate whatsapp', async () => {
    const a = await createDriver(valid({ whatsappNumber: '+447911000010' }), { db, operatorId });
    const b = await createDriver(valid({ name: 'Bob', whatsappNumber: '+447911000011' }), {
      db,
      operatorId,
    });
    if (!a.ok || !b.ok) throw new Error('setup');
    const r = await updateDriver(
      b.driver.id,
      { whatsappNumber: '+447911000010' },
      { db, operatorId },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('duplicate_whatsapp');
  });

  it('deactivate flips active and shows up in listAllDrivers but not listActiveDrivers', async () => {
    const created = await createDriver(valid(), { db, operatorId });
    if (!created.ok) throw new Error('setup');
    const d = await deactivateDriver(created.driver.id, { db, operatorId });
    expect(d.ok && d.driver.active).toBe(false);

    expect((await listActiveDrivers(db)).length).toBe(0);
    expect((await listAllDrivers(db)).length).toBe(1);
  });

  it('findDriverByWhatsapp returns active driver only', async () => {
    const created = await createDriver(valid(), { db, operatorId });
    if (!created.ok) throw new Error('setup');
    expect(await findDriverByWhatsapp(db, '+447911000001')).not.toBeNull();
    await deactivateDriver(created.driver.id, { db, operatorId });
    expect(await findDriverByWhatsapp(db, '+447911000001')).toBeNull();
  });

  it('getDriver returns null for unknown id', async () => {
    expect(await getDriver(db, '00000000-0000-0000-0000-000000000099')).toBeNull();
  });

  it('listActiveDrivers orders by vehicle class then name', async () => {
    await createDriver(
      valid({ name: 'A Exec', vehicleClass: 'executive', whatsappNumber: '+447911000101' }),
      { db, operatorId },
    );
    await createDriver(
      valid({ name: 'B MPV', vehicleClass: 'mpv', whatsappNumber: '+447911000102' }),
      { db, operatorId },
    );
    await createDriver(
      valid({ name: 'C Exec', vehicleClass: 'executive', whatsappNumber: '+447911000103' }),
      { db, operatorId },
    );
    const list = await listActiveDrivers(db);
    // Postgres enum declaration order: executive, luxury, mpv, coach.
    // listActiveDrivers orders by vehicle_class ASC, then name.
    expect(list.map((d) => `${d.vehicleClass}:${d.name}`)).toEqual([
      'executive:A Exec',
      'executive:C Exec',
      'mpv:B MPV',
    ]);
  });
});
