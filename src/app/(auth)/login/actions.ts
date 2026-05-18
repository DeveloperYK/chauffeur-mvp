'use server';

import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { sessionCookie } from '@/server/auth/cookie';
import { login } from '@/server/auth/login';
import { getDb } from '@/server/db';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';

const schema = z
  .object({
    email: z.string().email().min(3).max(254),
    password: z.string().min(1).max(256),
  })
  .strict();

export async function loginAction(formData: FormData): Promise<void> {
  const parsed = schema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) {
    redirect('/login?error=validation');
  }

  const url = env().DATABASE_URL;
  if (!url) {
    logger.error('DATABASE_URL not set; login is disabled');
    redirect('/login?error=config');
  }

  const { db } = getDb(url);
  const result = await login(parsed.data, { db });

  if (!result.ok) {
    redirect(`/login?error=${result.reason}`);
  }

  const jar = await cookies();
  jar.set(sessionCookie(result.session.token, result.session.expiresAt));
  redirect('/dashboard');
}
