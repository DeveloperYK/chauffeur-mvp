'use server';

import { currentSession } from '@/server/auth/current';
import { db, email, fakeMirror, fakeNotifier } from '@/server/composition';
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
  // SMS stays the in-memory fake (no real texts / Twilio cost, even on a prod
  // demo deploy). Email uses the REAL adapter so a clock tick that advances a
  // booking to in_progress sends a genuine en-route email — the only way to
  // verify exec email delivery end-to-end without waiting for the cron. Seed
  // bookings have no exec email, so the no-contact guard skips them; only a
  // booking with a real exec email on file actually sends.
  await clockTick({ db: db(), notifications: fakeNotifier, email: email() });
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
