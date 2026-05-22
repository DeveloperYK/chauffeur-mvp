'use server';

import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { currentSession } from '@/server/auth/current';
import { spreadsheetMirror } from '@/server/composition';
import { getDb } from '@/server/db';
import { createBooking } from '@/server/services/bookings';
import { redirect } from 'next/navigation';

export interface CreateBookingActionResult {
  error?: string;
  success?: boolean;
}

export async function createBookingAction(formData: FormData): Promise<CreateBookingActionResult> {
  const session = await currentSession();
  if (!session) {
    return { error: 'Not authenticated' };
  }

  const url = env().DATABASE_URL;
  if (!url) {
    logger.error('DATABASE_URL not set');
    return { error: 'Server not configured' };
  }

  const poundsRaw = formData.get('contractPricePounds');
  const pounds = poundsRaw == null ? 0 : Number.parseFloat(String(poundsRaw));
  const pence = Number.isFinite(pounds) ? Math.round(pounds * 100) : 0;

  const assignedDriverId = formData.get('assignedDriverId');
  const markAsAccepted = formData.get('markAsAccepted') === 'true';

  const raw = {
    pickupAt: String(formData.get('pickupAt') ?? ''),
    expectedDurationMinutes: String(formData.get('expectedDurationMinutes') ?? ''),
    pickupAddress: String(formData.get('pickupAddress') ?? ''),
    dropoffAddress: String(formData.get('dropoffAddress') ?? ''),
    passengerFirstName: String(formData.get('passengerFirstName') ?? ''),
    passengerLastName: String(formData.get('passengerLastName') ?? '') || null,
    execMobile: String(formData.get('execMobile') ?? ''),
    clientName: String(formData.get('clientName') ?? ''),
    accountCode: String(formData.get('accountCode') ?? ''),
    contractPricePence: pence,
    notes: (formData.get('notes') as string | null) ?? null,
    assignedDriverId: assignedDriverId ? String(assignedDriverId) : null,
    markAsAccepted,
  };

  const { db } = getDb(url);
  const result = await createBooking(raw, {
    db,
    operatorId: session.operator.id,
    mirror: spreadsheetMirror(),
  });

  if (!result.ok) {
    if (result.reason === 'pickup_in_past') {
      return { error: 'Pickup must be in the future.' };
    }
    if (result.reason === 'driver_not_found') {
      return { error: 'Selected driver not found.' };
    }
    if (result.reason === 'driver_inactive') {
      return { error: 'Selected driver is inactive.' };
    }
    const msg = result.issues
      .map((i) => `${i.path.join('.') || 'field'}: ${i.message}`)
      .slice(0, 3)
      .join('; ');
    return { error: msg };
  }

  return { success: true };
}

// Legacy action for backwards compatibility
export async function newBookingAction(formData: FormData): Promise<void> {
  const result = await createBookingAction(formData);
  if (result.error) {
    redirect(`/dashboard/new?error=${encodeURIComponent(result.error)}`);
  }
  redirect('/dashboard');
}
