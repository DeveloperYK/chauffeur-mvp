import type { Database } from '@/server/db';
import { operators } from '@/server/db/schema';
import { recordAuditEvent } from '@/server/services/audit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { hashPassword, verifyPassword } from './password';

/** New passwords must be at least 8 characters (matches `hashPassword`). */
const newPasswordSchema = z.string().min(8).max(200);

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

export type ChangePasswordResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'operator_not_found' | 'invalid_current_password' | 'weak_password' | 'same_password';
    };

/**
 * Change an operator's password. Verifies the current password, enforces a
 * minimum-strength new password that differs from the old one, swaps the hash,
 * and clears the `mustChangePassword` flag so a one-time temp password becomes
 * the operator's real, self-chosen password.
 */
export async function changePassword(
  db: Database,
  operatorId: string,
  input: ChangePasswordInput,
): Promise<ChangePasswordResult> {
  const parsed = newPasswordSchema.safeParse(input.newPassword);
  if (!parsed.success) return { ok: false, reason: 'weak_password' };
  if (input.newPassword === input.currentPassword) {
    return { ok: false, reason: 'same_password' };
  }

  const [op] = await db.select().from(operators).where(eq(operators.id, operatorId)).limit(1);
  if (!op) return { ok: false, reason: 'operator_not_found' };

  const currentOk = await verifyPassword(input.currentPassword, op.passwordHash);
  if (!currentOk) return { ok: false, reason: 'invalid_current_password' };

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
