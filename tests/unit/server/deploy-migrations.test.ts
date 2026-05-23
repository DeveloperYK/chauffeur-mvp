import { decideDeployMigration } from '@/server/deploy-migrations';
import { describe, expect, it } from 'vitest';

describe('decideDeployMigration', () => {
  it('runs on a Vercel production deploy with a migrate URL', () => {
    const d = decideDeployMigration({
      VERCEL_ENV: 'production',
      MIGRATE_DATABASE_URL: 'postgres://session-pooler/db',
    });
    expect(d).toEqual({ run: true, url: 'postgres://session-pooler/db' });
  });

  it('skips preview deploys (must never touch the production database)', () => {
    const d = decideDeployMigration({
      VERCEL_ENV: 'preview',
      MIGRATE_DATABASE_URL: 'postgres://session-pooler/db',
    });
    expect(d.run).toBe(false);
  });

  it('skips development deploys', () => {
    expect(
      decideDeployMigration({ VERCEL_ENV: 'development', MIGRATE_DATABASE_URL: 'x' }).run,
    ).toBe(false);
  });

  it('skips when not on Vercel (no VERCEL_ENV) — e.g. local builds', () => {
    expect(decideDeployMigration({ MIGRATE_DATABASE_URL: 'x' }).run).toBe(false);
  });

  it('skips production when no migrate URL is configured', () => {
    expect(decideDeployMigration({ VERCEL_ENV: 'production' }).run).toBe(false);
  });
});
