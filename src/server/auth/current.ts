import { env } from '@/lib/env';
import { getDb } from '@/server/db';
import { cookies } from 'next/headers';
import { SESSION_COOKIE_NAME } from './cookie';
import { type ValidatedSession, validateSession } from './sessions';

export async function currentSession(): Promise<ValidatedSession | null> {
  const url = env().DATABASE_URL;
  if (!url) return null;
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  const { db } = getDb(url);
  return validateSession(db, token);
}
