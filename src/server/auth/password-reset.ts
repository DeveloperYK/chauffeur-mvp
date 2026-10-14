import type { Database } from '@/server/db';
import { operators, passwordResetTokens } from '@/server/db/schema';
import type { EmailPort } from '@/server/ports/email';
import { recordAuditEvent } from '@/server/services/audit';
import { passwordResetEmail } from '@/server/services/password-reset-email';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { hashPassword } from './password';
import { RateLimiter } from './rate-limit';
import { invalidateAllSessionsForOperator } from './sessions';
import { generateSessionToken, hashSessionToken } from './tokens';

/** Reset links are valid for 30 minutes. */
export const PASSWORD_RESET_TTL_MS = 30 * 60_000;

/** Per-email limit on reset requests: 3 per 15 minutes, then exponential lockout. */
export const passwordResetRateLimiter = new RateLimiter({
  capacity: 3,
  refillIntervalMs: 15 * 60_000,
  baseLockoutMs: 5 * 60_000,
  maxLockoutMs: 60 * 60_000,
});

const newPasswordSchema = z.string().min(8).max(200);

export interface RequestPasswordResetDeps {
  db: Database;
  emailer: EmailPort;
  /** Public origin used to build the link, e.g. https://console.example.com */
  appUrl: string;
  now?: () => Date;
  rateLimiter?: RateLimiter;
  tokenGenerator?: () => string;
}

export type RequestPasswordResetResult =
  | { ok: true }
  | { ok: false; reason: 'rate_limited' | 'email_failed' };

/**
 * Start a self-service reset. Always answers `ok` for unknown or inactive
 * emails so the form cannot be used to enumerate operators. For a live
 * operator: consumes earlier unused tokens, stores the SHA-256 of a fresh
 * random token, and emails the raw token in a one-shot link.
 */
export async function requestPasswordReset(
  input: { email: string },
  deps: RequestPasswordResetDeps,
): Promise<RequestPasswordResetResult> {
  const email = input.email.trim().toLowerCase();
  const now = deps.now ? deps.now() : new Date();
  const limiter = deps.rateLimiter ?? passwordResetRateLimiter;
  if (!limiter.tryConsume(email, now.getTime())) return { ok: false, reason: 'rate_limited' };

  const [op] = await deps.db
    .select()
    .from(operators)
    .where(sql`lower(${operators.email}) = ${email} and ${operators.active} = true`)
    .limit(1);
  if (!op) return { ok: true };

  const token = (deps.tokenGenerator ?? generateSessionToken)();
  const expiresAt = new Date(now.getTime() + PASSWORD_RESET_TTL_MS);
  const resetUrl = `${deps.appUrl.replace(/\/$/, '')}/reset-password?token=${token}`;

  const sent = await deps.emailer.sendEmail({
    to: op.email,
    ...passwordResetEmail({
      name: op.name,
      resetUrl,
      expiresMinutes: PASSWORD_RESET_TTL_MS / 60_000,
    }),
  });
  if (!sent.ok) return { ok: false, reason: 'email_failed' };

  await deps.db
    .update(passwordResetTokens)
    .set({ usedAt: now })
    .where(and(eq(passwordResetTokens.operatorId, op.id), isNull(passwordResetTokens.usedAt)));
  await deps.db
    .insert(passwordResetTokens)
    .values({ operatorId: op.id, tokenHash: hashSessionToken(token), expiresAt });

  await recordAuditEvent(deps.db, {
    actorType: 'operator',
    actorId: op.id,
    entityType: 'operator',
    entityId: op.id,
    action: 'password_reset_requested',
    before: null,
    after: { expiresAt: expiresAt.toISOString() },
  });
  return { ok: true };
}

export type CompletePasswordResetResult =
  | { ok: true; operatorId: string }
  | { ok: false; reason: 'invalid_token' | 'expired_token' | 'weak_password' };

/**
 * Finish a reset from the emailed link. The token is looked up by hash, must
 * be unused and unexpired. On success the password is replaced, the token is
 * consumed, any temp-password flag is cleared and every session is revoked.
 */
export async function completePasswordReset(
  db: Database,
  input: { token: string; newPassword: string },
  now: () => Date = () => new Date(),
): Promise<CompletePasswordResetResult> {
  const at = now();
  const [row] = await db
    .select()
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.tokenHash, hashSessionToken(input.token)),
        isNull(passwordResetTokens.usedAt),
      ),
    )
    .limit(1);
  if (!row) return { ok: false, reason: 'invalid_token' };
  if (row.expiresAt.getTime() < at.getTime()) return { ok: false, reason: 'expired_token' };

  if (!newPasswordSchema.safeParse(input.newPassword).success) {
    return { ok: false, reason: 'weak_password' };
  }

  const [op] = await db.select().from(operators).where(eq(operators.id, row.operatorId)).limit(1);
  if (!op || !op.active) return { ok: false, reason: 'invalid_token' };

  const passwordHash = await hashPassword(input.newPassword);
  await db
    .update(operators)
    .set({ passwordHash, mustChangePassword: false, updatedAt: at })
    .where(eq(operators.id, op.id));
  await db
    .update(passwordResetTokens)
    .set({ usedAt: at })
    .where(eq(passwordResetTokens.id, row.id));
  await invalidateAllSessionsForOperator(db, op.id);

  await recordAuditEvent(db, {
    actorType: 'operator',
    actorId: op.id,
    entityType: 'operator',
    entityId: op.id,
    action: 'password_reset',
    before: { mustChangePassword: op.mustChangePassword },
    after: { mustChangePassword: false },
  });
  return { ok: true, operatorId: op.id };
}

export type AdminResetPasswordResult =
  | { ok: true; operatorId: string }
  | { ok: false; reason: 'operator_not_found' | 'weak_password' };

/**
 * Operator-admin reset run from the CLI (scripts/reset-operator-password.ts):
 * sets a password — usually a temporary one the operator must change on first
 * login — and revokes every existing session for the account.
 */
export async function adminResetPassword(
  db: Database,
  input: { email: string; newPassword: string; mustChangePassword: boolean },
): Promise<AdminResetPasswordResult> {
  if (!newPasswordSchema.safeParse(input.newPassword).success) {
    return { ok: false, reason: 'weak_password' };
  }
  const email = input.email.trim().toLowerCase();
  const [op] = await db
    .select()
    .from(operators)
    .where(sql`lower(${operators.email}) = ${email}`)
    .limit(1);
  if (!op) return { ok: false, reason: 'operator_not_found' };

  const passwordHash = await hashPassword(input.newPassword);
  await db
    .update(operators)
    .set({ passwordHash, mustChangePassword: input.mustChangePassword, updatedAt: new Date() })
    .where(eq(operators.id, op.id));
  await invalidateAllSessionsForOperator(db, op.id);

  await recordAuditEvent(db, {
    actorType: 'system',
    actorId: null,
    entityType: 'operator',
    entityId: op.id,
    action: 'admin_password_reset',
    before: { mustChangePassword: op.mustChangePassword },
    after: { mustChangePassword: input.mustChangePassword },
  });
  return { ok: true, operatorId: op.id };
}
