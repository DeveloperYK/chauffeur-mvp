import { auditEvents, bookings, drivers, operators } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestDb, createTestDb } from '~test/helpers/pglite-db';

describe('db schema — integration (pglite)', () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const t = await createTestDb();
    db = t.db;
    close = t.close;
  });

  afterAll(async () => {
    await close();
  });

  it('inserts and retrieves an operator', async () => {
    const [op] = await db
      .insert(operators)
      .values({
        email: 'op1@example.com',
        passwordHash: 'argon2:fake',
        name: 'Alice',
      })
      .returning();
    expect(op).toBeDefined();
    expect(op?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(op?.active).toBe(true);
  });

  it('enforces unique email (case-insensitive)', async () => {
    await db.insert(operators).values({
      email: 'dup@example.com',
      passwordHash: 'x',
      name: 'A',
    });
    await expect(
      db.insert(operators).values({
        email: 'DUP@example.com',
        passwordHash: 'x',
        name: 'B',
      }),
    ).rejects.toThrow();
  });

  it('inserts a driver and a booking referencing it', async () => {
    const [driver] = await db
      .insert(drivers)
      .values({
        name: 'Tom',
        tier: 'premium',
        defaultCarType: 's_class',
        whatsappNumber: '+447911000001',
      })
      .returning();
    expect(driver).toBeDefined();

    const [booking] = await db
      .insert(bookings)
      .values({
        pickupAt: new Date(Date.now() + 86_400_000),
        expectedDurationMinutes: 90,
        pickupAddress: '11 Belsize Park Gardens',
        dropoffAddress: 'LHR Terminal 5',
        passengerFirstName: 'Eric',
        passengerLastName: 'French',
        execMobile: '+447911123456',
        bookerName: 'Jack',
        accountCode: 'LEGO',
        carTypePreference: 's_class',
        contractPricePence: 30000,
      })
      .returning();

    expect(booking?.state).toBe('unassigned');
    expect(booking?.assignedDriverId).toBeNull();

    const [updated] = await db
      .update(bookings)
      .set({
        state: 'assigned',
        assignedDriverId: driver?.id ?? null,
        carForThisJob: 's_class',
        assignedAt: new Date(),
      })
      .where(eq(bookings.id, booking?.id ?? ''))
      .returning();
    expect(updated?.state).toBe('assigned');
    expect(updated?.assignedDriverId).toBe(driver?.id);
  });

  it('records an audit event with jsonb before/after', async () => {
    const [evt] = await db
      .insert(auditEvents)
      .values({
        actorType: 'operator',
        actorId: null,
        entityType: 'booking',
        entityId: '00000000-0000-0000-0000-000000000001',
        action: 'state_change',
        before: { state: 'unassigned' },
        after: { state: 'assigned' },
      })
      .returning();
    expect(evt?.before).toEqual({ state: 'unassigned' });
    expect(evt?.after).toEqual({ state: 'assigned' });
  });

  it('rejects unique whatsapp constraint on driver', async () => {
    await db.insert(drivers).values({
      name: 'X',
      tier: 'ordinary',
      defaultCarType: 'ex',
      whatsappNumber: '+447911000900',
    });
    await expect(
      db.insert(drivers).values({
        name: 'Y',
        tier: 'ordinary',
        defaultCarType: 'ex',
        whatsappNumber: '+447911000900',
      }),
    ).rejects.toThrow();
  });
});
