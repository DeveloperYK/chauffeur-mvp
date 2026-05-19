import { env } from '@/lib/env';
import { getDb } from '@/server/db';
import { operators } from '@/server/db/schema';
import { asc, eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { SESSION_COOKIE_NAME } from './cookie';
import { type ValidatedSession, validateSession } from './sessions';

/**
 * Look up the current operator session.
 *
 * In non-production environments, when no cookie session exists, we fall back
 * to the first active operator so the login flow can be skipped during local
 * development. Production never auto-logs anyone in.
 */
export async function currentSession(): Promise<ValidatedSession | null> {
  const url = env().DATABASE_URL;
  if (!url) return null;
  const { db } = getDb(url);

  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE_NAME)?.value;
  if (token) {
    const found = await validateSession(db, token);
    if (found) return found;
  }

  if (env().NODE_ENV !== 'production') {
    const rows = await db
      .select()
      .from(operators)
      .where(eq(operators.active, true))
      .orderBy(asc(operators.createdAt))
      .limit(1);
    const op = rows[0];
    if (op) {
      const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
      return { operator: op, expiresAt: farFuture, refreshed: false };
    }
  }

  return null;
}
