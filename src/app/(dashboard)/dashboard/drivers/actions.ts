'use server';

import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { currentSession } from '@/server/auth/current';
import { getDb } from '@/server/db';
import { clearDriverTimeOff, setDriverTimeOff } from '@/server/services/driver-availability';
import { updateDriver } from '@/server/services/drivers';
import { revalidatePath } from 'next/cache';
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

// ── Time-off ─────────────────────────────────────────────────────────────

export interface TimeOffActionResult {
  ok: boolean;
  error?: string;
}

export async function setDriverTimeOffAction(input: {
  driverId: string;
  startsOn: string;
  endsOn: string;
}): Promise<TimeOffActionResult> {
  const session = await currentSession();
  if (!session) return { ok: false, error: 'Not authenticated.' };

  const url = env().DATABASE_URL;
  if (!url) {
    logger.error('DATABASE_URL not set');
    return { ok: false, error: 'Database not configured.' };
  }
  const { db } = getDb(url);
  const r = await setDriverTimeOff(input, session.operator.id, { db });
  if (!r.ok) {
    const error =
      r.reason === 'driver_not_found'
        ? 'Driver not found.'
        : r.reason === 'validation'
          ? 'Please check the dates.'
          : 'Could not save time-off.';
    return { ok: false, error };
  }
  revalidatePath('/dashboard/drivers');
  revalidatePath('/dashboard');
  return { ok: true };
}

export async function clearDriverTimeOffAction(timeOffId: string): Promise<TimeOffActionResult> {
  const session = await currentSession();
  if (!session) return { ok: false, error: 'Not authenticated.' };

  const url = env().DATABASE_URL;
  if (!url) {
    logger.error('DATABASE_URL not set');
    return { ok: false, error: 'Database not configured.' };
  }
  const { db } = getDb(url);
  const r = await clearDriverTimeOff(timeOffId, session.operator.id, { db });
  if (!r.ok) {
    return { ok: false, error: 'Time-off entry not found.' };
  }
  revalidatePath('/dashboard/drivers');
  revalidatePath('/dashboard');
  return { ok: true };
}
