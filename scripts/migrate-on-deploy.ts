// Runs Drizzle migrations during the Vercel build — but only on production
// deploys (see decideDeployMigration). Invoked from vercel.json buildCommand:
//   pnpm run migrate:deploy && pnpm build
//
// Uses MIGRATE_DATABASE_URL (the Supabase *session* pooler, :5432) because the
// runtime DATABASE_URL is the transaction pooler (:6543, prepare:false) which
// can't run DDL reliably. A Postgres advisory lock serialises concurrent
// production deploys so two builds can't apply the same migration at once.
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { logger } from '../src/lib/logger';
import { decideDeployMigration } from '../src/server/deploy-migrations';

// Arbitrary constant — identifies our migration lock across deploy runs.
const MIGRATION_LOCK_KEY = 481_517_293;

async function main(): Promise<void> {
  const decision = decideDeployMigration({
    VERCEL_ENV: process.env.VERCEL_ENV,
    MIGRATE_DATABASE_URL: process.env.MIGRATE_DATABASE_URL,
  });

  if (!decision.run) {
    logger.info({ reason: decision.reason }, 'migrate-on-deploy: skipping migrations');
    return;
  }

  const client = postgres(decision.url, { max: 1 });
  try {
    await client`SELECT pg_advisory_lock(${MIGRATION_LOCK_KEY})`;
    logger.info('migrate-on-deploy: running migrations');
    await migrate(drizzle(client), { migrationsFolder: './drizzle' });
    logger.info('migrate-on-deploy: migrations complete');
  } finally {
    await client`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY})`.catch(() => {});
    await client.end();
  }
}

main().catch((err) => {
  logger.error({ err }, 'migrate-on-deploy: FAILED — aborting build');
  process.exit(1);
});
