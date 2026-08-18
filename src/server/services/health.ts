import type { Database } from '@/server/db';
import { sql } from 'drizzle-orm';

/**
 * Cheap liveness probe against the database. Returns false instead of
 * throwing so callers (the /api/healthz route) can map failure to a 503
 * without exception control flow.
 */
export async function checkDatabase(db: Database): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}
