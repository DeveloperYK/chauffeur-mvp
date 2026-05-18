// Usage:
//   DATABASE_URL=... pnpm tsx scripts/create-operator.ts "alice@example.com" "Alice" "long-password-here"
//
// Creates (or refuses if email exists) an operator. Password must be ≥12 chars.

import { logger } from '../src/lib/logger';
import { createOperator, getOperatorByEmail } from '../src/server/auth/login';
import { getDb } from '../src/server/db';

async function main() {
  const [email, name, password] = process.argv.slice(2);
  if (!email || !name || !password) {
    logger.error('usage: tsx scripts/create-operator.ts <email> <name> <password>');
    process.exit(2);
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL must be set');
  const { db, close } = getDb(url);
  const existing = await getOperatorByEmail(db, email);
  if (existing) {
    logger.error({ email }, 'operator with this email already exists');
    await close();
    process.exit(1);
  }
  const created = await createOperator(db, { email, name, password });
  logger.info({ id: created.id, email }, 'operator created');
  await close();
}

main().catch((err) => {
  logger.error({ err }, 'create-operator failed');
  process.exit(1);
});
