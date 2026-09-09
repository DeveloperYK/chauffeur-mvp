import { checkBoardPath, checkDatabase } from '@/server/services/health';
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

// The deep check runs the SAME queries the board render runs, in parallel,
// through the same pool. `/api/healthz` (select 1) stayed green for 26 hours
// while every board load was timing out — a probe that only pings Postgres
// says nothing about whether operators can see the board.
describe('checkBoardPath', () => {
  it('reports ok with a timing against a live database', async () => {
    const { db, close } = await createTestDb();
    const r = await checkBoardPath(db, { today: '2026-09-09' });
    expect(r.ok).toBe(true);
    expect(r.ms).toBeGreaterThanOrEqual(0);
    await close();
  });

  it('is repeatable — consecutive checks both succeed', async () => {
    const { db, close } = await createTestDb();
    await expect(checkBoardPath(db, { today: '2026-09-09' })).resolves.toMatchObject({ ok: true });
    await expect(checkBoardPath(db, { today: '2026-09-09' })).resolves.toMatchObject({ ok: true });
    await close();
  });

  it('still reports ok with bookings, drivers and operators present', async () => {
    const { db, close } = await createTestDb();
    await db.query.operators.findMany();
    const r = await checkBoardPath(db, { today: '2026-09-09' });
    expect(r).toMatchObject({ ok: true });
    await close();
  });

  it('reports a failure (not an exception) when the database is unreachable', async () => {
    const { db, close } = await createTestDb();
    await close();
    const r = await checkBoardPath(db, { today: '2026-09-09' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('error');
      expect(r.message.length).toBeGreaterThan(0);
    }
  });

  it('reports a timeout when the board queries exceed the budget', async () => {
    const { db, close } = await createTestDb();
    // Simulate the production failure: the pool accepts the work and never
    // answers (the query batch is injected so the hang is deterministic).
    const hang = () => new Promise<never>(() => {});
    const r = await checkBoardPath(db, { today: '2026-09-09', timeoutMs: 20, work: hang });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('timeout');
    await close();
  });

  it('rejects a malformed day string instead of querying with it', async () => {
    const { db, close } = await createTestDb();
    const r = await checkBoardPath(db, { today: 'not-a-day' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('error');
    await close();
  });
});
