'use server';

import { currentSession } from '@/server/auth/current';
import { db, fakeMirror, fakeNotifier, notifications } from '@/server/composition';
import type { BookingState } from '@/server/db/schema';
import { clockTick } from '@/server/services/clock-tick';
import {
  fastForwardBooking,
  resetAllData,
  seedSampleData,
  setBookingState,
} from '@/server/services/simulator';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

function assertDev(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('simulator is disabled in production');
  }
}

async function requireSession() {
  const session = await currentSession();
  if (!session) redirect('/login');
  return session;
}

export async function seedAction(): Promise<void> {
  assertDev();
  const session = await requireSession();
  await seedSampleData(db(), session.operator.id);
  revalidatePath('/dashboard/simulator');
  revalidatePath('/dashboard');
  redirect('/dashboard/simulator?ok=seeded');
}

export async function resetAction(): Promise<void> {
  assertDev();
  await requireSession();
  await resetAllData(db());
  fakeNotifier.reset();
  fakeMirror.reset();
  revalidatePath('/dashboard/simulator');
  revalidatePath('/dashboard');
  redirect('/dashboard/simulator?ok=reset');
}

export async function clockTickAction(): Promise<void> {
  assertDev();
  await requireSession();
  await clockTick({ db: db(), notifications: notifications() });
  revalidatePath('/dashboard/simulator');
  revalidatePath('/dashboard');
  redirect('/dashboard/simulator?ok=ticked');
}

export async function fastForwardAction(formData: FormData): Promise<void> {
  assertDev();
  await requireSession();
  const bookingId = String(formData.get('bookingId') ?? '');
  const scenario = String(formData.get('scenario') ?? '') as
    | 'about_to_start'
    | 'trip_finished'
    | 'aged_unaccepted';
  if (!bookingId || !scenario) redirect('/dashboard/simulator?error=missing');
  await fastForwardBooking(db(), bookingId, scenario);
  revalidatePath('/dashboard/simulator');
  revalidatePath('/dashboard');
  redirect('/dashboard/simulator?ok=fast-forwarded');
}

export async function forceStateAction(formData: FormData): Promise<void> {
  assertDev();
  const session = await requireSession();
  const bookingId = String(formData.get('bookingId') ?? '');
  const state = String(formData.get('state') ?? '') as BookingState;
  if (!bookingId || !state) redirect('/dashboard/simulator?error=missing');
  await setBookingState(db(), bookingId, state, session.operator.id);
  revalidatePath('/dashboard/simulator');
  revalidatePath('/dashboard');
  redirect('/dashboard/simulator?ok=forced');
}
