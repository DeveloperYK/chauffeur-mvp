import { FakeEmailAdapter } from '@/server/adapters/email-fake';
import { getOperatorByEmail, login } from '@/server/auth/login';
import { hashPassword } from '@/server/auth/password';
import {
  PASSWORD_RESET_TTL_MS,
  adminResetPassword,
  completePasswordReset,
  requestPasswordReset,
} from '@/server/auth/password-reset';
import { RateLimiter } from '@/server/auth/rate-limit';
import { createSession, validateSession } from '@/server/auth/sessions';
import { auditEvents, operators, passwordResetTokens } from '@/server/db/schema';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestDb, createTestDb } from '~test/helpers/pglite-db';

const EMAIL = 'ozie@example.com';
const OLD = 'old-password-123';
const NEW = 'brand-new-passw0rd';
const APP_URL = 'https://console.example.com';
const T0 = new Date('2026-10-14T10:00:00Z');

function limiter(capacity = 100) {
  return new RateLimiter({
    capacity,
    refillIntervalMs: 15 * 60_000,
    baseLockoutMs: 1_000,
    maxLockoutMs: 60_000,
  });
}

function loginLimiter() {
  return new RateLimiter({
    capacity: 100,
    refillIntervalMs: 60_000,
    baseLockoutMs: 1_000,
    maxLockoutMs: 60_000,
  });
}

function tokenFromEmail(emailer: FakeEmailAdapter): string {
  const last = emailer.sent.at(-1);
  if (!last) throw new Error('no email sent');
  const m = last.text.match(/\/reset-password\?token=([A-Za-z0-9_-]+)/);
  if (!m?.[1]) throw new Error(`no reset link in email: ${last.text}`);
  return m[1];
}

describe('auth/password-reset (integration)', () => {
  let db: TestDb;
  let close: () => Promise<void>;
  let emailer: FakeEmailAdapter;
  // Argon2id is deliberately slow (~0.5 s on a CI runner). Hash the seed
  // password once per file and insert the hash directly, so only the code
  // under test pays for hashing.
  let oldHash: string;

  beforeAll(async () => {
    oldHash = await hashPassword(OLD);
  });

  beforeEach(async () => {
    const t = await createTestDb();
    db = t.db;
    close = t.close;
    emailer = new FakeEmailAdapter();
  });
  afterEach(async () => {
    await close();
  });

  async function seedOperator(opts: { active?: boolean; mustChangePassword?: boolean } = {}) {
    const [op] = await db
      .insert(operators)
      .values({
        email: EMAIL,
        passwordHash: oldHash,
        name: 'Ozie',
        active: opts.active ?? true,
        mustChangePassword: opts.mustChangePassword ?? false,
      })
      .returning({ id: operators.id });
    if (!op) throw new Error('seed failed');
    return op.id;
  }

  async function storedHash(): Promise<string | undefined> {
    return (await getOperatorByEmail(db, EMAIL))?.passwordHash;
  }

  function request(email = EMAIL, now = T0, rl = limiter()) {
    return requestPasswordReset(
      { email },
      { db, emailer, appUrl: APP_URL, now: () => now, rateLimiter: rl },
    );
  }

  describe('requestPasswordReset', () => {
    it('emails the operator a reset link and stores only a hash of the token', async () => {
      const id = await seedOperator();
      const r = await request();
      expect(r).toEqual({ ok: true });

      expect(emailer.sent).toHaveLength(1);
      const msg = emailer.sent[0];
      expect(msg?.to).toBe(EMAIL);
      expect(msg?.subject).toMatch(/reset/i);
      expect(msg?.text).toContain(`${APP_URL}/reset-password?token=`);
      expect(msg?.html).toContain(`${APP_URL}/reset-password?token=`);

      const token = tokenFromEmail(emailer);
      const rows = await db.select().from(passwordResetTokens);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.operatorId).toBe(id);
      expect(rows[0]?.tokenHash).not.toBe(token);
      expect(rows[0]?.tokenHash).not.toContain(token);
      expect(rows[0]?.usedAt).toBeNull();
      expect(rows[0]?.expiresAt.getTime()).toBe(T0.getTime() + PASSWORD_RESET_TTL_MS);
    });

    it('is case-insensitive on email and audits the request', async () => {
      const id = await seedOperator();
      await request('  OZIE@Example.com ');
      expect(emailer.sent).toHaveLength(1);
      const ev = (await db.select().from(auditEvents)).find(
        (e) => e.action === 'password_reset_requested',
      );
      expect(ev?.entityId).toBe(id);
    });

    it('says ok for an unknown email but sends nothing and stores nothing', async () => {
      await seedOperator();
      const r = await request('nobody@example.com');
      expect(r).toEqual({ ok: true });
      expect(emailer.sent).toHaveLength(0);
      expect(await db.select().from(passwordResetTokens)).toHaveLength(0);
    });

    it('sends nothing for a deactivated operator', async () => {
      await seedOperator({ active: false });
      const r = await request();
      expect(r).toEqual({ ok: true });
      expect(emailer.sent).toHaveLength(0);
    });

    it('invalidates earlier unused tokens when a new one is requested', async () => {
      await seedOperator();
      await request();
      const first = tokenFromEmail(emailer);
      await request();
      const second = tokenFromEmail(emailer);
      expect(first).not.toBe(second);

      const r1 = await completePasswordReset(db, { token: first, newPassword: NEW }, () => T0);
      expect(r1).toEqual({ ok: false, reason: 'invalid_token' });
      const r2 = await completePasswordReset(db, { token: second, newPassword: NEW }, () => T0);
      expect(r2.ok).toBe(true);
    });

    it('is rate limited per email', async () => {
      await seedOperator();
      const rl = limiter(2);
      expect(await request(EMAIL, T0, rl)).toEqual({ ok: true });
      expect(await request(EMAIL, T0, rl)).toEqual({ ok: true });
      expect(await request(EMAIL, T0, rl)).toEqual({ ok: false, reason: 'rate_limited' });
      expect(emailer.sent).toHaveLength(2);
    });

    it('reports email delivery failure without leaving a usable token', async () => {
      await seedOperator();
      emailer.simulateFailure('network_error');
      const r = await request();
      expect(r).toEqual({ ok: false, reason: 'email_failed' });
      expect(await db.select().from(passwordResetTokens)).toHaveLength(0);
    });
  });

  describe('completePasswordReset', () => {
    it('sets the new password, consumes the token, clears the temp flag, kills sessions, audits', async () => {
      const id = await seedOperator({ mustChangePassword: true });
      const session = await createSession(db, id, T0);
      await request();
      const token = tokenFromEmail(emailer);

      const r = await completePasswordReset(db, { token, newPassword: NEW }, () => T0);
      expect(r).toEqual({ ok: true, operatorId: id });

      const op = await getOperatorByEmail(db, EMAIL);
      expect(op?.mustChangePassword).toBe(false);

      const okNew = await login(
        { email: EMAIL, password: NEW },
        { db, rateLimiter: loginLimiter() },
      );
      expect(okNew.ok).toBe(true);
      const okOld = await login(
        { email: EMAIL, password: OLD },
        { db, rateLimiter: loginLimiter() },
      );
      expect(okOld.ok).toBe(false);

      expect(await validateSession(db, session.token)).toBeNull();

      const row = (await db.select().from(passwordResetTokens))[0];
      expect(row?.usedAt?.getTime()).toBe(T0.getTime());

      const ev = (await db.select().from(auditEvents)).find((e) => e.action === 'password_reset');
      expect(ev?.actorId).toBe(id);
      expect(ev?.entityId).toBe(id);
    });

    it('rejects a token that does not exist', async () => {
      await seedOperator();
      const r = await completePasswordReset(
        db,
        { token: 'not-a-real-token', newPassword: NEW },
        () => T0,
      );
      expect(r).toEqual({ ok: false, reason: 'invalid_token' });
    });

    it('rejects an expired token', async () => {
      await seedOperator();
      await request();
      const token = tokenFromEmail(emailer);
      const later = new Date(T0.getTime() + PASSWORD_RESET_TTL_MS + 1);
      const r = await completePasswordReset(db, { token, newPassword: NEW }, () => later);
      expect(r).toEqual({ ok: false, reason: 'expired_token' });
      expect(await storedHash()).toBe(oldHash);
    });

    it('rejects a token that was already used', async () => {
      await seedOperator();
      await request();
      const token = tokenFromEmail(emailer);
      expect((await completePasswordReset(db, { token, newPassword: NEW }, () => T0)).ok).toBe(
        true,
      );
      const again = await completePasswordReset(
        db,
        { token, newPassword: 'another-passw0rd' },
        () => T0,
      );
      expect(again).toEqual({ ok: false, reason: 'invalid_token' });
    });

    it('rejects a weak password and leaves the token usable', async () => {
      await seedOperator();
      await request();
      const token = tokenFromEmail(emailer);
      const weak = await completePasswordReset(db, { token, newPassword: 'short' }, () => T0);
      expect(weak).toEqual({ ok: false, reason: 'weak_password' });
      const ok = await completePasswordReset(db, { token, newPassword: NEW }, () => T0);
      expect(ok.ok).toBe(true);
    });
  });

  describe('adminResetPassword', () => {
    it('sets a temporary password, flags must-change, kills sessions and audits', async () => {
      const id = await seedOperator();
      const session = await createSession(db, id, T0);
      const r = await adminResetPassword(db, {
        email: EMAIL,
        newPassword: 'Temp-pass-2026',
        mustChangePassword: true,
      });
      expect(r).toEqual({ ok: true, operatorId: id });

      const op = await getOperatorByEmail(db, EMAIL);
      expect(op?.mustChangePassword).toBe(true);
      expect(await validateSession(db, session.token)).toBeNull();

      const ok = await login(
        { email: EMAIL, password: 'Temp-pass-2026' },
        { db, rateLimiter: loginLimiter() },
      );
      expect(ok.ok).toBe(true);

      const ev = (await db.select().from(auditEvents)).find(
        (e) => e.action === 'admin_password_reset',
      );
      expect(ev?.actorType).toBe('system');
      expect(ev?.entityId).toBe(id);
    });

    it('can set a permanent password (flag false)', async () => {
      await seedOperator({ mustChangePassword: true });
      const r = await adminResetPassword(db, {
        email: EMAIL,
        newPassword: NEW,
        mustChangePassword: false,
      });
      expect(r.ok).toBe(true);
      expect((await getOperatorByEmail(db, EMAIL))?.mustChangePassword).toBe(false);
    });

    it('matches the email case-insensitively', async () => {
      await seedOperator();
      const r = await adminResetPassword(db, {
        email: 'OZIE@EXAMPLE.COM',
        newPassword: NEW,
        mustChangePassword: true,
      });
      expect(r.ok).toBe(true);
    });

    it('fails for an unknown operator', async () => {
      const r = await adminResetPassword(db, {
        email: 'nobody@example.com',
        newPassword: NEW,
        mustChangePassword: true,
      });
      expect(r).toEqual({ ok: false, reason: 'operator_not_found' });
    });

    it('fails for a weak password', async () => {
      await seedOperator();
      const r = await adminResetPassword(db, {
        email: EMAIL,
        newPassword: 'short',
        mustChangePassword: true,
      });
      expect(r).toEqual({ ok: false, reason: 'weak_password' });
    });
  });
});
