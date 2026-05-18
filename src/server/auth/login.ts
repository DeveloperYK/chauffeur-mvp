import type { Database } from '@/server/db';
import { operators } from '@/server/db/schema';
import { sql } from 'drizzle-orm';
import { verifyPassword } from './password';
import { type RateLimiter, loginRateLimiter } from './rate-limit';
import { type CreatedSession, createSession } from './sessions';

export type LoginResult =
  | { ok: true; session: CreatedSession }
  | { ok: false; reason: 'invalid_credentials' | 'rate_limited' };

export interface LoginInput {
  email: string;
  password: string;
}

export interface LoginDeps {
  db: Database;
  rateLimiter?: RateLimiter;
  now?: () => Date;
}

export async function login(input: LoginInput, deps: LoginDeps): Promise<LoginResult> {
  const limiter = deps.rateLimiter ?? loginRateLimiter;
  const key = input.email.trim().toLowerCase();
  const nowDate = deps.now ? deps.now() : new Date();

  if (!limiter.tryConsume(key, nowDate.getTime())) {
    return { ok: false, reason: 'rate_limited' };
  }

  const rows = await deps.db
    .select()
    .from(operators)
    .where(sql`lower(${operators.email}) = ${key} and ${operators.active} = true`)
    .limit(1);
  const op = rows[0];

  // Always run a verify even if user not found — defeats timing oracle.
  const okHash = op?.passwordHash ?? '$argon2id$v=19$m=19456,t=2,p=1$Zm9vYmFy$AAAA';
  const passwordOk = await verifyPassword(input.password, okHash);

  if (!op || !passwordOk) {
    return { ok: false, reason: 'invalid_credentials' };
  }

  // Refresh the rate-limit window on success
  limiter.reset(key);

  const session = await createSession(deps.db, op.id, nowDate);
  return { ok: true, session };
}

export async function logout(db: Database, token: string): Promise<void> {
  const { invalidateSession } = await import('./sessions');
  await invalidateSession(db, token);
}

export async function createOperator(
  db: Database,
  input: { email: string; password: string; name: string },
): Promise<{ id: string }> {
  const { hashPassword } = await import('./password');
  const passwordHash = await hashPassword(input.password);
  const [op] = await db
    .insert(operators)
    .values({
      email: input.email.trim().toLowerCase(),
      passwordHash,
      name: input.name,
    })
    .returning();
  if (!op) throw new Error('failed to create operator');
  return { id: op.id };
}

export async function getOperatorByEmail(db: Database, email: string) {
  const rows = await db
    .select()
    .from(operators)
    .where(sql`lower(${operators.email}) = ${email.trim().toLowerCase()}`)
    .limit(1);
  return rows[0] ?? null;
}
