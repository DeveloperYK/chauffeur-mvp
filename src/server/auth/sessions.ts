import type { Database } from '@/server/db';
import { type Operator, operators, sessions } from '@/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { generateSessionToken, hashSessionToken } from './tokens';

export const SESSION_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
export const SESSION_REFRESH_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // refresh if older than 7 days

export interface CreatedSession {
  token: string; // raw token for the cookie
  expiresAt: Date;
}

export interface ValidatedSession {
  operator: Operator;
  expiresAt: Date;
  refreshed: boolean;
}

export async function createSession(
  db: Database,
  operatorId: string,
  now: Date = new Date(),
): Promise<CreatedSession> {
  const token = generateSessionToken();
  const id = hashSessionToken(token);
  const expiresAt = new Date(now.getTime() + SESSION_LIFETIME_MS);
  await db.insert(sessions).values({ id, userId: operatorId, expiresAt });
  return { token, expiresAt };
}

export async function validateSession(
  db: Database,
  token: string,
  now: Date = new Date(),
): Promise<ValidatedSession | null> {
  const id = hashSessionToken(token);
  const rows = await db
    .select({
      session: sessions,
      operator: operators,
    })
    .from(sessions)
    .innerJoin(operators, eq(sessions.userId, operators.id))
    .where(and(eq(sessions.id, id), eq(operators.active, true)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  // Expired
  if (row.session.expiresAt.getTime() <= now.getTime()) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }

  // Sliding refresh
  const age = SESSION_LIFETIME_MS - (row.session.expiresAt.getTime() - now.getTime());
  let expiresAt = row.session.expiresAt;
  let refreshed = false;
  if (age > SESSION_REFRESH_THRESHOLD_MS) {
    expiresAt = new Date(now.getTime() + SESSION_LIFETIME_MS);
    await db.update(sessions).set({ expiresAt }).where(eq(sessions.id, id));
    refreshed = true;
  }

  return { operator: row.operator, expiresAt, refreshed };
}

export async function invalidateSession(db: Database, token: string): Promise<void> {
  const id = hashSessionToken(token);
  await db.delete(sessions).where(eq(sessions.id, id));
}

export async function invalidateAllSessionsForOperator(
  db: Database,
  operatorId: string,
): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, operatorId));
}
