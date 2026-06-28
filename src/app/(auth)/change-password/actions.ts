'use server';

import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { changePassword } from '@/server/auth/change-password';
import { currentSession } from '@/server/auth/current';
import { getDb } from '@/server/db';
import { redirect } from 'next/navigation';
import { z } from 'zod';

const schema = z
  .object({
    currentPassword: z.string().min(1).max(256),
    newPassword: z.string().min(1).max(256),
    confirmPassword: z.string().min(1).max(256),
  })
  .strict();

export async function changePasswordAction(formData: FormData): Promise<void> {
  const parsed = schema.safeParse({
    currentPassword: formData.get('currentPassword'),
    newPassword: formData.get('newPassword'),
    confirmPassword: formData.get('confirmPassword'),
  });
  if (!parsed.success) redirect('/change-password?error=validation');
  if (parsed.data.newPassword !== parsed.data.confirmPassword) {
    redirect('/change-password?error=mismatch');
  }

  const session = await currentSession();
  if (!session) redirect('/login');

  const url = env().DATABASE_URL;
  if (!url) {
    logger.error('DATABASE_URL not set; password change is disabled');
    redirect('/change-password?error=config');
  }
  const { db } = getDb(url);

  const result = await changePassword(db, session.operator.id, {
    currentPassword: parsed.data.currentPassword,
    newPassword: parsed.data.newPassword,
  });

  if (!result.ok) {
    const code =
      result.reason === 'invalid_current_password'
        ? 'current'
        : result.reason === 'weak_password'
          ? 'weak'
          : result.reason === 'same_password'
            ? 'same'
            : 'notfound';
    redirect(`/change-password?error=${code}`);
  }

  redirect('/dashboard');
}
