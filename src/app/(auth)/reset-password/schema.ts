import { z } from 'zod';

/** Tokens are base64url (see generateSessionToken). */
export const resetTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/);

const schema = z
  .object({
    token: resetTokenSchema,
    newPassword: z.string().min(1).max(256),
    confirmPassword: z.string().min(1).max(256),
  })
  .strict();

export type ResetPasswordFormResult =
  | { ok: true; token: string; newPassword: string }
  | { ok: false; error: 'validation' | 'mismatch' | 'weak' };

export function parseResetPasswordForm(input: unknown): ResetPasswordFormResult {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };
  const { token, newPassword, confirmPassword } = parsed.data;
  if (newPassword !== confirmPassword) return { ok: false, error: 'mismatch' };
  if (newPassword.length < 8) return { ok: false, error: 'weak' };
  return { ok: true, token, newPassword };
}
