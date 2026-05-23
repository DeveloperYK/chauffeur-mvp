import { PGlite } from '@electric-sql/pglite';
import { type PgliteDatabase, drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { type PostgresJsDatabase, drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Database = PostgresJsDatabase<typeof schema> | PgliteDatabase<typeof schema>;

let cached: { db: Database; close: () => Promise<void> } | undefined;

export function getDb(url: string): { db: Database; close: () => Promise<void> } {
  if (cached) return cached;
  // `prepare: false` is required when connecting through a transaction-mode
  // pooler (e.g. Supabase Supavisor on :6543), where prepared statements can't
  // span pooled backend connections. Harmless on direct/session connections.
  const client = postgres(url, { max: 10, idle_timeout: 20, prepare: false });
  const db = drizzlePostgres(client, { schema });
  cached = {
    db,
    close: async () => {
      await client.end();
      cached = undefined;
    },
  };
  return cached;
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
