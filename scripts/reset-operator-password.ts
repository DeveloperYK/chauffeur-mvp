// Usage:
//   DATABASE_URL=... pnpm tsx scripts/reset-operator-password.ts "ozie@example.com" "temp-password-here" [--temp]
//
// Sets an existing operator's password and signs them out everywhere.
// --temp marks it temporary: the operator must choose a new password on first login.

import { logger } from '../src/lib/logger';
import { adminResetPassword } from '../src/server/auth/password-reset';
import { getDb } from '../src/server/db';

async function main() {
  const args = process.argv.slice(2);
  const mustChangePassword = args.includes('--temp');
  const [email, password] = args.filter((a) => a !== '--temp');
  if (!email || !password) {
    logger.error('usage: tsx scripts/reset-operator-password.ts <email> <password> [--temp]');
    process.exit(2);
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL must be set');
  const { db, close } = getDb(url);
  const result = await adminResetPassword(db, { email, newPassword: password, mustChangePassword });
  if (!result.ok) {
    logger.error({ email, reason: result.reason }, 'password reset refused');
    await close();
    process.exit(1);
  }
  logger.info({ id: result.operatorId, email, mustChangePassword }, 'operator password reset');
  await close();
}

main().catch((err) => {
  logger.error({ err }, 'reset-operator-password failed');
  process.exit(1);
});
