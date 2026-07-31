import { z } from 'zod';

const schema = z
  .object({
    newPassword: z.string().min(1).max(256),
    confirmPassword: z.string().min(1).max(256),
  })
  .strict();

export type ChangePasswordFormResult =
  | { ok: true; newPassword: string }
  | { ok: false; error: 'validation' | 'mismatch' };

export function parseChangePasswordForm(input: unknown): ChangePasswordFormResult {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };
  if (parsed.data.newPassword !== parsed.data.confirmPassword) {
    return { ok: false, error: 'mismatch' };
  }
  return { ok: true, newPassword: parsed.data.newPassword };
}
