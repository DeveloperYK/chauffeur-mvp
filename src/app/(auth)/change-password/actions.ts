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
    newPassword: z.string().min(1).max(256),
  })
  .strict();

export async function changePasswordAction(formData: FormData): Promise<void> {
  const parsed = schema.safeParse({
    newPassword: formData.get('newPassword'),
  });
  if (!parsed.success) redirect('/change-password?error=validation');

  const session = await currentSession();
  if (!session) redirect('/login');

  const url = env().DATABASE_URL;
  if (!url) {
    logger.error('DATABASE_URL not set; password change is disabled');
    redirect('/change-password?error=config');
  }
  const { db } = getDb(url);

  const result = await changePassword(db, session.operator.id, {
    newPassword: parsed.data.newPassword,
  });

  if (!result.ok) {
    const code = result.reason === 'weak_password' ? 'weak' : 'notfound';
    redirect(`/change-password?error=${code}`);
  }

  redirect('/dashboard');
}
