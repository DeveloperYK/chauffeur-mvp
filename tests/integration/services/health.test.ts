import { checkDatabase } from '@/server/services/health';
import { describe, expect, it } from 'vitest';
import { createTestDb } from '../../helpers/pglite-db';

describe('checkDatabase', () => {
  it('returns true against a live database', async () => {
    const { db, close } = await createTestDb();
    await expect(checkDatabase(db)).resolves.toBe(true);
    await close();
  });

  it('is repeatable — consecutive probes both succeed', async () => {
    const { db, close } = await createTestDb();
    await expect(checkDatabase(db)).resolves.toBe(true);
    await expect(checkDatabase(db)).resolves.toBe(true);
    await close();
  });

  it('still reports true after real queries have run on the connection', async () => {
    const { db, close } = await createTestDb();
    await db.query.operators.findMany();
    await expect(checkDatabase(db)).resolves.toBe(true);
    await close();
  });

  it('returns false when the database is unreachable (closed connection)', async () => {
    const { db, close } = await createTestDb();
    await close();
    await expect(checkDatabase(db)).resolves.toBe(false);
  });

  it('does not throw on a dead connection — failure is a value, not an exception', async () => {
    const { db, close } = await createTestDb();
    await close();
    // Two probes in a row must both settle to false without rejecting.
    await expect(checkDatabase(db)).resolves.toBe(false);
    await expect(checkDatabase(db)).resolves.toBe(false);
  });
});
