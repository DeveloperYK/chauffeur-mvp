import * as schema from '@/server/db/schema';
import { PGlite } from '@electric-sql/pglite';
import { type PgliteDatabase, drizzle } from 'drizzle-orm/pglite';
import { loadMigrationsSql, loadTemplate, templatePath } from './pglite-template';

export type TestDb = PgliteDatabase<typeof schema>;

/**
 * Spin up an isolated in-memory Postgres with the full schema applied.
 *
 * Boots from the migrated template that vitest's globalSetup saved to disk
 * (~90 ms). Falls back to initdb + migrations (~400 ms) when the template is
 * missing, e.g. when a helper is run outside vitest.
 */
export async function createTestDb(): Promise<{
  db: TestDb;
  client: PGlite;
  close: () => Promise<void>;
}> {
  const template = loadTemplate(templatePath());
  const client = template ? new PGlite({ loadDataDir: template }) : new PGlite();
  const db = drizzle(client, { schema });
  if (!template) await client.exec(loadMigrationsSql());
  else await client.waitReady;
  return {
    db,
    client,
    close: async () => {
      await client.close();
    },
  };
}
