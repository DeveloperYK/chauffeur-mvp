'use server';

import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { completePasswordReset } from '@/server/auth/password-reset';
import { getDb } from '@/server/db';
import { redirect } from 'next/navigation';
import { parseResetPasswordForm } from './schema';

export async function resetPasswordAction(formData: FormData): Promise<void> {
  const parsed = parseResetPasswordForm({
    token: formData.get('token'),
    newPassword: formData.get('newPassword'),
    confirmPassword: formData.get('confirmPassword'),
  });
  if (!parsed.ok) {
    const token = typeof formData.get('token') === 'string' ? String(formData.get('token')) : '';
    redirect(`/reset-password?token=${encodeURIComponent(token)}&error=${parsed.error}`);
  }

  const url = env().DATABASE_URL;
  if (!url) {
    logger.error('DATABASE_URL not set; password reset is disabled');
    redirect(`/reset-password?token=${encodeURIComponent(parsed.token)}&error=config`);
  }
  const { db } = getDb(url);

  const result = await completePasswordReset(db, {
    token: parsed.token,
    newPassword: parsed.newPassword,
  });
  if (!result.ok) {
    const code = result.reason === 'weak_password' ? 'weak' : result.reason;
    redirect(`/reset-password?token=${encodeURIComponent(parsed.token)}&error=${code}`);
  }

  redirect('/login?reset=1');
}
