import { createOperator, login, logout } from '@/server/auth/login';
import { RateLimiter } from '@/server/auth/rate-limit';
import {
  SESSION_LIFETIME_MS,
  createSession,
  invalidateAllSessionsForOperator,
  validateSession,
} from '@/server/auth/sessions';
import { auditEvents, sessions } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type TestDb, createTestDb } from '~test/helpers/pglite-db';

describe('auth/login + sessions (integration)', () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeEach(async () => {
    const t = await createTestDb();
    db = t.db;
    close = t.close;
  });

  afterEach(async () => {
    await close();
  });

  function freshLimiter() {
    return new RateLimiter({
      capacity: 100,
      refillIntervalMs: 60_000,
      baseLockoutMs: 1_000,
      maxLockoutMs: 60_000,
    });
  }

  it('createOperator + login(success)', async () => {
    await createOperator(db, {
      email: 'alice@example.com',
      password: 'correct-horse-battery',
      name: 'Alice',
    });
    const result = await login(
      { email: 'alice@example.com', password: 'correct-horse-battery' },
      { db, rateLimiter: freshLimiter() },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session.token).toBeTruthy();
      expect(result.session.expiresAt.getTime()).toBeGreaterThan(Date.now());
    }
  });

  it('login is case-insensitive on email', async () => {
    await createOperator(db, {
      email: 'alice@example.com',
      password: 'correct-horse-battery',
      name: 'Alice',
    });
    const result = await login(
      { email: 'ALICE@Example.com', password: 'correct-horse-battery' },
      { db, rateLimiter: freshLimiter() },
    );
    expect(result.ok).toBe(true);
  });

  it('rejects wrong password without leaking which field was wrong', async () => {
    await createOperator(db, {
      email: 'alice@example.com',
      password: 'correct-horse-battery',
      name: 'Alice',
    });
    const r1 = await login(
      { email: 'alice@example.com', password: 'wrong-password-here' },
      { db, rateLimiter: freshLimiter() },
    );
    const r2 = await login(
      { email: 'noone@example.com', password: 'whatever-12char' },
      { db, rateLimiter: freshLimiter() },
    );
    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(false);
    if (!r1.ok && !r2.ok) {
      expect(r1.reason).toBe('invalid_credentials');
      expect(r2.reason).toBe('invalid_credentials');
    }
  });

  it('returns rate_limited after exceeding bucket', async () => {
    await createOperator(db, {
      email: 'alice@example.com',
      password: 'correct-horse-battery',
      name: 'Alice',
    });
    const limiter = new RateLimiter({
      capacity: 2,
      refillIntervalMs: 60_000,
      baseLockoutMs: 1_000,
      maxLockoutMs: 60_000,
    });
    const r1 = await login(
      { email: 'alice@example.com', password: 'wrong' },
      { db, rateLimiter: limiter },
    );
    const r2 = await login(
      { email: 'alice@example.com', password: 'wrong' },
      { db, rateLimiter: limiter },
    );
    const r3 = await login(
      { email: 'alice@example.com', password: 'wrong' },
      { db, rateLimiter: limiter },
    );
    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(false);
    expect(r3.ok).toBe(false);
    if (!r3.ok) expect(r3.reason).toBe('rate_limited');
  });

  it('inactive operator cannot log in', async () => {
    const created = await createOperator(db, {
      email: 'alice@example.com',
      password: 'correct-horse-battery',
      name: 'Alice',
    });
    const { operators } = await import('@/server/db/schema');
    await db.update(operators).set({ active: false }).where(eq(operators.id, created.id));
    const result = await login(
      { email: 'alice@example.com', password: 'correct-horse-battery' },
      { db, rateLimiter: freshLimiter() },
    );
    expect(result.ok).toBe(false);
  });

  it('validateSession returns null for unknown token', async () => {
    expect(await validateSession(db, 'no-such-token')).toBeNull();
  });

  it('validateSession returns operator for active token, then logout invalidates it', async () => {
    const created = await createOperator(db, {
      email: 'alice@example.com',
      password: 'correct-horse-battery',
      name: 'Alice',
    });
    const { token } = await createSession(db, created.id);
    const v = await validateSession(db, token);
    expect(v?.operator.email).toBe('alice@example.com');
    await logout(db, token);
    expect(await validateSession(db, token)).toBeNull();
  });

  it('expired session is removed on validate', async () => {
    const created = await createOperator(db, {
      email: 'alice@example.com',
      password: 'correct-horse-battery',
      name: 'Alice',
    });
    // Create a session manually with past expiry by inserting directly
    const longAgo = new Date(Date.now() - SESSION_LIFETIME_MS - 1_000);
    const { token } = await createSession(db, created.id, longAgo);
    expect(await validateSession(db, token)).toBeNull();
    // and the row is gone
    const rows = await db.select().from(sessions);
    expect(rows.length).toBe(0);
  });

  it('invalidateAllSessionsForOperator clears all', async () => {
    const created = await createOperator(db, {
      email: 'alice@example.com',
      password: 'correct-horse-battery',
      name: 'Alice',
    });
    await createSession(db, created.id);
    await createSession(db, created.id);
    await invalidateAllSessionsForOperator(db, created.id);
    const rows = await db.select().from(sessions);
    expect(rows.length).toBe(0);
  });

  describe('login audit trail', () => {
    async function seedAlice() {
      return createOperator(db, {
        email: 'alice@example.com',
        password: 'correct-horse-battery',
        name: 'Alice',
      });
    }

    it('records a login audit event for the operator on success', async () => {
      const { id } = await seedAlice();
      const result = await login(
        { email: 'alice@example.com', password: 'correct-horse-battery' },
        { db, rateLimiter: freshLimiter() },
      );
      expect(result.ok).toBe(true);
      const rows = await db.select().from(auditEvents).where(eq(auditEvents.action, 'login'));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.actorType).toBe('operator');
      expect(rows[0]?.actorId).toBe(id);
      expect(rows[0]?.entityType).toBe('operator');
      expect(rows[0]?.entityId).toBe(id);
    });

    it('stores the session expiry in the event, never the token', async () => {
      await seedAlice();
      const result = await login(
        { email: 'alice@example.com', password: 'correct-horse-battery' },
        { db, rateLimiter: freshLimiter() },
      );
      if (!result.ok) throw new Error('login should succeed');
      const [row] = await db.select().from(auditEvents).where(eq(auditEvents.action, 'login'));
      const after = row?.after as { sessionExpiresAt?: string } | null;
      expect(after?.sessionExpiresAt).toBe(result.session.expiresAt.toISOString());
      expect(JSON.stringify(row)).not.toContain(result.session.token);
    });

    it('records one event per successful login', async () => {
      await seedAlice();
      for (let i = 0; i < 3; i++) {
        await login(
          { email: 'alice@example.com', password: 'correct-horse-battery' },
          { db, rateLimiter: freshLimiter() },
        );
      }
      const rows = await db.select().from(auditEvents).where(eq(auditEvents.action, 'login'));
      expect(rows).toHaveLength(3);
    });

    it('records nothing for a wrong password', async () => {
      await seedAlice();
      await login(
        { email: 'alice@example.com', password: 'wrong-password-here' },
        { db, rateLimiter: freshLimiter() },
      );
      const rows = await db.select().from(auditEvents).where(eq(auditEvents.action, 'login'));
      expect(rows).toHaveLength(0);
    });

    it('records nothing for an unknown email', async () => {
      await login(
        { email: 'nobody@example.com', password: 'whatever-12char' },
        { db, rateLimiter: freshLimiter() },
      );
      const rows = await db.select().from(auditEvents).where(eq(auditEvents.action, 'login'));
      expect(rows).toHaveLength(0);
    });

    it('records nothing when the account is rate-limited', async () => {
      await seedAlice();
      const limiter = new RateLimiter({
        capacity: 1,
        refillIntervalMs: 60_000,
        baseLockoutMs: 60_000,
        maxLockoutMs: 60_000,
      });
      await login(
        { email: 'alice@example.com', password: 'wrong-password-here' },
        { db, rateLimiter: limiter },
      );
      const blocked = await login(
        { email: 'alice@example.com', password: 'correct-horse-battery' },
        { db, rateLimiter: limiter },
      );
      expect(blocked.ok).toBe(false);
      const rows = await db.select().from(auditEvents).where(eq(auditEvents.action, 'login'));
      expect(rows).toHaveLength(0);
    });
  });
});
