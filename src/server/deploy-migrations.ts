/**
 * Decide whether a Vercel build should run database migrations.
 *
 * Migrations run ONLY on Vercel **production** deploys, and only when a
 * dedicated migration connection string is configured. Preview/branch builds
 * must never mutate the production database, and local builds skip entirely.
 *
 * The migrate URL is intentionally separate from the runtime DATABASE_URL: the
 * runtime uses the Supabase transaction pooler (:6543, prepare:false) which is
 * unsuitable for DDL, whereas MIGRATE_DATABASE_URL is the session pooler
 * (:5432) that supports migrations.
 */
export interface DeployMigrationEnv {
  VERCEL_ENV?: string | undefined;
  MIGRATE_DATABASE_URL?: string | undefined;
}

export type DeployMigrationDecision = { run: true; url: string } | { run: false; reason: string };

export function decideDeployMigration(env: DeployMigrationEnv): DeployMigrationDecision {
  if (env.VERCEL_ENV !== 'production') {
    return {
      run: false,
      reason: `not a production deploy (VERCEL_ENV=${env.VERCEL_ENV ?? 'unset'})`,
    };
  }
  if (!env.MIGRATE_DATABASE_URL) {
    return { run: false, reason: 'MIGRATE_DATABASE_URL is not set' };
  }
  return { run: true, url: env.MIGRATE_DATABASE_URL };
}
