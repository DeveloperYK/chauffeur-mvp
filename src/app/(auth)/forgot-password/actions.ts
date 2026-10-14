'use server';

import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { requestPasswordReset } from '@/server/auth/password-reset';
import { email as emailPort } from '@/server/composition';
import { getDb } from '@/server/db';
import { redirect } from 'next/navigation';
import { parseForgotPasswordForm } from './schema';

export async function forgotPasswordAction(formData: FormData): Promise<void> {
  const parsed = parseForgotPasswordForm({ email: formData.get('email') });
  if (!parsed.ok) redirect('/forgot-password?error=validation');

  const e = env();
  if (!e.DATABASE_URL) {
    logger.error('DATABASE_URL not set; password reset is disabled');
    redirect('/forgot-password?error=config');
  }
  const { db } = getDb(e.DATABASE_URL);

  const result = await requestPasswordReset(
    { email: parsed.email },
    { db, emailer: emailPort(), appUrl: e.APP_URL },
  );
  if (!result.ok) {
    logger.warn({ reason: result.reason }, 'password reset request failed');
    redirect(`/forgot-password?error=${result.reason}`);
  }
  redirect('/forgot-password?sent=1');
}
