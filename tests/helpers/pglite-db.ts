import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as schema from '@/server/db/schema';
import { PGlite } from '@electric-sql/pglite';
import { type PgliteDatabase, drizzle } from 'drizzle-orm/pglite';

export type TestDb = PgliteDatabase<typeof schema>;

const MIGRATIONS_DIR = join(process.cwd(), 'drizzle');

let cachedSql: string | undefined;

function loadMigrationsSql(): string {
  if (cachedSql) return cachedSql;
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  cachedSql = files
    .map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))
    .join('\n')
    // Drizzle uses --> statement-breakpoint as a separator. PGlite needs us to
    // execute each statement individually-ish; replace with semicolons.
    .replace(/--> statement-breakpoint/g, '');
  return cachedSql;
}

/**
 * Spin up an isolated in-memory Postgres for one test.
 * Cost: ~50-100ms per call. Use sparingly; share with `describe` blocks where possible.
 */
export async function createTestDb(): Promise<{
  db: TestDb;
  client: PGlite;
  close: () => Promise<void>;
}> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await client.exec(loadMigrationsSql());
  return {
    db,
    client,
    close: async () => {
      await client.close();
    },
  };
}
