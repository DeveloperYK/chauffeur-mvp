import type { Database } from '@/server/db';
import { operators } from '@/server/db/schema';
import { recordAuditEvent } from '@/server/services/audit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { hashPassword } from './password';

/** New passwords must be at least 8 characters (matches `hashPassword`). */
const newPasswordSchema = z.string().min(8).max(200);

export interface ChangePasswordInput {
  newPassword: string;
}

export type ChangePasswordResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'operator_not_found' | 'weak_password';
    };

/**
 * Set an operator's password. Enforces a minimum-strength new password, swaps
 * the hash, and clears the `mustChangePassword` flag so a one-time temp password
 * becomes the operator's real, self-chosen password. The caller must already
 * hold an authenticated operator session — the current password is not required.
 */
export async function changePassword(
  db: Database,
  operatorId: string,
  input: ChangePasswordInput,
): Promise<ChangePasswordResult> {
  const parsed = newPasswordSchema.safeParse(input.newPassword);
  if (!parsed.success) return { ok: false, reason: 'weak_password' };

  const [op] = await db.select().from(operators).where(eq(operators.id, operatorId)).limit(1);
  if (!op) return { ok: false, reason: 'operator_not_found' };

  const passwordHash = await hashPassword(input.newPassword);
  await db
    .update(operators)
    .set({ passwordHash, mustChangePassword: false, updatedAt: new Date() })
    .where(eq(operators.id, op.id));

  await recordAuditEvent(db, {
    actorType: 'operator',
    actorId: op.id,
    entityType: 'operator',
    entityId: op.id,
    action: 'change_password',
    before: { mustChangePassword: op.mustChangePassword },
    after: { mustChangePassword: false },
  });

  return { ok: true };
}
