import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { logger } from '../src/lib/logger';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL must be set');
  }
  const client = postgres(url, { max: 1 });
  const db = drizzle(client);
  logger.info('running drizzle migrations');
  await migrate(db, { migrationsFolder: './drizzle' });
  logger.info('migrations complete');
  await client.end();
}

main().catch((err) => {
  logger.error({ err }, 'migration failed');
  process.exit(1);
});
