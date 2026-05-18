'use server';

import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { currentSession } from '@/server/auth/current';
import { getDb } from '@/server/db';
import { createBooking } from '@/server/services/bookings';
import { redirect } from 'next/navigation';

export async function newBookingAction(formData: FormData): Promise<void> {
  const session = await currentSession();
  if (!session) redirect('/login');

  const url = env().DATABASE_URL;
  if (!url) {
    logger.error('DATABASE_URL not set');
    redirect('/dashboard/new?error=Server%20not%20configured');
  }

  const poundsRaw = formData.get('contractPricePounds');
  const pounds = poundsRaw == null ? 0 : Number.parseFloat(String(poundsRaw));
  const pence = Number.isFinite(pounds) ? Math.round(pounds * 100) : 0;

  const raw = {
    pickupAt: String(formData.get('pickupAt') ?? ''),
    expectedDurationMinutes: String(formData.get('expectedDurationMinutes') ?? ''),
    pickupAddress: String(formData.get('pickupAddress') ?? ''),
    dropoffAddress: String(formData.get('dropoffAddress') ?? ''),
    passengerFirstName: String(formData.get('passengerFirstName') ?? ''),
    passengerLastName: String(formData.get('passengerLastName') ?? ''),
    execMobile: String(formData.get('execMobile') ?? ''),
    bookerName: String(formData.get('bookerName') ?? ''),
    accountCode: String(formData.get('accountCode') ?? ''),
    carTypePreference: String(formData.get('carTypePreference') ?? ''),
    contractPricePence: pence,
    notes: (formData.get('notes') as string | null) ?? null,
  };

  const { db } = getDb(url);
  const result = await createBooking(raw, { db, operatorId: session.operator.id });

  if (!result.ok) {
    if (result.reason === 'pickup_in_past') {
      redirect(`/dashboard/new?error=${encodeURIComponent('Pickup must be in the future.')}`);
    }
    const msg = result.issues
      .map((i) => `${i.path.join('.') || 'field'}: ${i.message}`)
      .slice(0, 3)
      .join('; ');
    redirect(`/dashboard/new?error=${encodeURIComponent(msg)}`);
  }

  redirect('/dashboard');
}
