'use server';

import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { currentSession } from '@/server/auth/current';
import { getDb } from '@/server/db';
import { updateDriver } from '@/server/services/drivers';
import { redirect } from 'next/navigation';

export async function deactivateDriverAction(formData: FormData): Promise<void> {
  await setDriverActive(formData, false);
}

export async function reactivateDriverAction(formData: FormData): Promise<void> {
  await setDriverActive(formData, true);
}

async function setDriverActive(formData: FormData, active: boolean): Promise<void> {
  const session = await currentSession();
  if (!session) redirect('/login');

  const id = String(formData.get('id') ?? '');
  if (!id) redirect('/dashboard/drivers');

  const url = env().DATABASE_URL;
  if (!url) {
    logger.error('DATABASE_URL not set');
    redirect('/dashboard/drivers');
  }
  const { db } = getDb(url);
  await updateDriver(id, { active }, { db, operatorId: session.operator.id });
  redirect('/dashboard/drivers');
}
