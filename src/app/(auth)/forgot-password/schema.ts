import { z } from 'zod';

const schema = z
  .object({
    email: z.string().trim().toLowerCase().email().min(3).max(254),
  })
  .strict();

export type ForgotPasswordFormResult =
  | { ok: true; email: string }
  | { ok: false; error: 'validation' };

export function parseForgotPasswordForm(input: unknown): ForgotPasswordFormResult {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };
  return { ok: true, email: parsed.data.email };
}
