'use server';

import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { currentSession } from '@/server/auth/current';
import { getDb } from '@/server/db';
import { updateDriver } from '@/server/services/drivers';
import { redirect } from 'next/navigation';

export async function editDriverAction(formData: FormData): Promise<void> {
  const session = await currentSession();
  if (!session) redirect('/login');

  const id = String(formData.get('id') ?? '');
  if (!id) redirect('/dashboard/drivers');

  const url = env().DATABASE_URL;
  if (!url) {
    logger.error('DATABASE_URL not set');
    redirect(`/dashboard/drivers/${id}/edit?error=Server%20not%20configured`);
  }
  const { db } = getDb(url);
  const result = await updateDriver(
    id,
    {
      name: String(formData.get('name') ?? ''),
      vehicleClass: String(formData.get('vehicleClass') ?? ''),
      car: String(formData.get('car') ?? ''),
      carColour: String(formData.get('carColour') ?? ''),
      whatsappNumber: String(formData.get('whatsappNumber') ?? ''),
    },
    { db, operatorId: session.operator.id },
  );
  if (!result.ok) {
    if (result.reason === 'duplicate_whatsapp') {
      redirect(
        `/dashboard/drivers/${id}/edit?error=${encodeURIComponent(
          'A driver with that WhatsApp number already exists.',
        )}`,
      );
    }
    if (result.reason === 'not_found') {
      redirect('/dashboard/drivers');
    }
    const msg = result.issues
      .map((i) => `${i.path.join('.') || 'field'}: ${i.message}`)
      .slice(0, 3)
      .join('; ');
    redirect(`/dashboard/drivers/${id}/edit?error=${encodeURIComponent(msg)}`);
  }
  redirect('/dashboard/drivers');
}
