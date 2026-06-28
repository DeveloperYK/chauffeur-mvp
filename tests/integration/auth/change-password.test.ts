import { changePassword } from '@/server/auth/change-password';
import { createOperator, getOperatorByEmail, login } from '@/server/auth/login';
import { RateLimiter } from '@/server/auth/rate-limit';
import { auditEvents } from '@/server/db/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type TestDb, createTestDb } from '~test/helpers/pglite-db';

const TEMP = 'temp-password-123';
const NEW = 'my-real-passw0rd';

describe('auth/changePassword (integration)', () => {
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

  function limiter() {
    return new RateLimiter({
      capacity: 100,
      refillIntervalMs: 60_000,
      baseLockoutMs: 1_000,
      maxLockoutMs: 60_000,
    });
  }

  async function seedTempAccount() {
    const { id } = await createOperator(db, {
      email: 'dev@example.com',
      password: TEMP,
      name: 'Dev',
      mustChangePassword: true,
    });
    return id;
  }

  it('createOperator seeds the must-change-password flag', async () => {
    await seedTempAccount();
    const op = await getOperatorByEmail(db, 'dev@example.com');
    expect(op?.mustChangePassword).toBe(true);
  });

  it('changes the password, clears the flag, and audits it', async () => {
    const id = await seedTempAccount();
    const r = await changePassword(db, id, { currentPassword: TEMP, newPassword: NEW });
    expect(r.ok).toBe(true);

    const op = await getOperatorByEmail(db, 'dev@example.com');
    expect(op?.mustChangePassword).toBe(false);

    const event = (await db.select().from(auditEvents)).find((e) => e.action === 'change_password');
    expect(event?.actorId).toBe(id);

    // The new password works and the old one no longer does.
    const good = await login(
      { email: 'dev@example.com', password: NEW },
      { db, rateLimiter: limiter() },
    );
    expect(good.ok).toBe(true);
    const bad = await login(
      { email: 'dev@example.com', password: TEMP },
      { db, rateLimiter: limiter() },
    );
    expect(bad.ok).toBe(false);
  });

  it('rejects a wrong current password (flag stays set)', async () => {
    const id = await seedTempAccount();
    const r = await changePassword(db, id, { currentPassword: 'wrong-password', newPassword: NEW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid_current_password');
    const op = await getOperatorByEmail(db, 'dev@example.com');
    expect(op?.mustChangePassword).toBe(true);
  });

  it('rejects a new password under 12 characters', async () => {
    const id = await seedTempAccount();
    const r = await changePassword(db, id, { currentPassword: TEMP, newPassword: 'short' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('weak_password');
  });

  it('rejects reusing the current password', async () => {
    const id = await seedTempAccount();
    const r = await changePassword(db, id, { currentPassword: TEMP, newPassword: TEMP });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('same_password');
  });

  it('rejects an unknown operator', async () => {
    const r = await changePassword(db, '00000000-0000-0000-0000-000000000000', {
      currentPassword: TEMP,
      newPassword: NEW,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('operator_not_found');
  });
});
