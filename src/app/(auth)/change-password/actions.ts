'use server';

import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { changePassword } from '@/server/auth/change-password';
import { currentSession } from '@/server/auth/current';
import { getDb } from '@/server/db';
import { redirect } from 'next/navigation';
import { parseChangePasswordForm } from './schema';

export async function changePasswordAction(formData: FormData): Promise<void> {
  const parsed = parseChangePasswordForm({
    newPassword: formData.get('newPassword'),
    confirmPassword: formData.get('confirmPassword'),
  });
  if (!parsed.ok) redirect(`/change-password?error=${parsed.error}`);

  const session = await currentSession();
  if (!session) redirect('/login');

  const url = env().DATABASE_URL;
  if (!url) {
    logger.error('DATABASE_URL not set; password change is disabled');
    redirect('/change-password?error=config');
  }
  const { db } = getDb(url);

  const result = await changePassword(db, session.operator.id, {
    newPassword: parsed.newPassword,
  });

  if (!result.ok) {
    const code = result.reason === 'weak_password' ? 'weak' : 'notfound';
    redirect(`/change-password?error=${code}`);
  }

  redirect('/dashboard');
}
