import { PGlite } from '@electric-sql/pglite';
import { type PgliteDatabase, drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { type PostgresJsDatabase, drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Database = PostgresJsDatabase<typeof schema> | PgliteDatabase<typeof schema>;

import { logger } from '@/lib/logger';

let cached: { db: Database; close: () => Promise<void>; reset: () => Promise<void> } | undefined;

/**
 * Pool settings tuned for a serverless host that freezes idle instances and
 * a transaction-mode pooler in front of Postgres. See docs/adr/0014-db-fail-fast.md.
 * - `max: 5` — one instance never holds more than a handful of pooler slots.
 * - `connect_timeout` / `max_lifetime` — a socket the pooler has dropped while
 *   the instance was frozen is discarded rather than reused indefinitely.
 * - `keep_alive` — TCP keepalive so a dead peer is noticed sooner.
 * - `prepare: false` — required through Supavisor on :6543, where prepared
 *   statements can't span pooled backend connections.
 */
export const POOL_OPTIONS = {
  max: 5,
  idle_timeout: 20,
  connect_timeout: 10,
  max_lifetime: 10 * 60,
  keep_alive: 30,
  prepare: false,
} as const;

export function getDb(url: string): {
  db: Database;
  close: () => Promise<void>;
  reset: () => Promise<void>;
} {
  if (cached) return cached;
  const client = postgres(url, POOL_OPTIONS);
  const db = drizzlePostgres(client, { schema });
  cached = {
    db,
    close: async () => {
      await client.end();
      cached = undefined;
    },
    // Hard teardown: destroy every socket now (timeout 0) and forget the pool,
    // so the next `getDb` opens fresh connections. Used when a query hangs —
    // the stuck sockets would otherwise pin the pool until the instance dies.
    reset: async () => {
      cached = undefined;
      logger.warn('db pool reset — dropping all connections');
      await client.end({ timeout: 0 });
    },
  };
  return cached;
}

/** Tear down the cached pool (no-op when none is open). See `getDb().reset`. */
export async function resetDb(): Promise<void> {
  if (!cached) return;
  await cached.reset();
}

export function createPgliteDb(): {
  db: PgliteDatabase<typeof schema>;
  client: PGlite;
} {
  const client = new PGlite();
  const db = drizzlePglite(client, { schema });
  return { db, client };
}

export * from './schema';
