'use server';

import { currentSession } from '@/server/auth/current';
import { db, fakeMirror, fakeNotifier } from '@/server/composition';
import type { BookingState } from '@/server/db/schema';
import { simulatorEnabled } from '@/server/feature-flags';
import { clockTick } from '@/server/services/clock-tick';
import {
  fastForwardBooking,
  resetAllData,
  seedSampleData,
  setBookingState,
  simulateExecMessageFailure,
} from '@/server/services/simulator';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

function assertSimulatorEnabled(): void {
  if (!simulatorEnabled()) {
    throw new Error('simulator is disabled');
  }
}

async function requireSession() {
  const session = await currentSession();
  if (!session) redirect('/login');
  return session;
}

export async function seedAction(): Promise<void> {
  assertSimulatorEnabled();
  const session = await requireSession();
  await seedSampleData(db(), session.operator.id);
  revalidatePath('/dashboard/simulator');
  revalidatePath('/dashboard');
  redirect('/dashboard/simulator?ok=seeded');
}

export async function resetAction(): Promise<void> {
  assertSimulatorEnabled();
  await requireSession();
  await resetAllData(db());
  fakeNotifier.reset();
  fakeMirror.reset();
  revalidatePath('/dashboard/simulator');
  revalidatePath('/dashboard');
  redirect('/dashboard/simulator?ok=reset');
}

export async function clockTickAction(): Promise<void> {
  assertSimulatorEnabled();
  await requireSession();
  // Always use the in-memory fake here so the simulator never sends real SMS,
  // even on a production demo deploy where notifications() is the live Twilio
  // adapter. The "SMS sent" panel reads this same fake.
  await clockTick({ db: db(), notifications: fakeNotifier });
  revalidatePath('/dashboard/simulator');
  revalidatePath('/dashboard');
  redirect('/dashboard/simulator?ok=ticked');
}

export async function fastForwardAction(formData: FormData): Promise<void> {
  assertSimulatorEnabled();
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

export async function forceExecFailureAction(formData: FormData): Promise<void> {
  assertSimulatorEnabled();
  await requireSession();
  const bookingId = String(formData.get('bookingId') ?? '');
  if (!bookingId) redirect('/dashboard/simulator?error=missing');
  await simulateExecMessageFailure(db(), bookingId);
  revalidatePath('/dashboard/simulator');
  revalidatePath('/dashboard');
  redirect('/dashboard/simulator?ok=exec-failed');
}

export async function forceStateAction(formData: FormData): Promise<void> {
  assertSimulatorEnabled();
  const session = await requireSession();
  const bookingId = String(formData.get('bookingId') ?? '');
  const state = String(formData.get('state') ?? '') as BookingState;
  if (!bookingId || !state) redirect('/dashboard/simulator?error=missing');
  await setBookingState(db(), bookingId, state, session.operator.id);
  revalidatePath('/dashboard/simulator');
  revalidatePath('/dashboard');
  redirect('/dashboard/simulator?ok=forced');
}
