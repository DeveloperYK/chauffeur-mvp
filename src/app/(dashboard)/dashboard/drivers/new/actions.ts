'use server';

import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { currentSession } from '@/server/auth/current';
import { getDb } from '@/server/db';
import { createDriver } from '@/server/services/drivers';
import { redirect } from 'next/navigation';

export async function newDriverAction(formData: FormData): Promise<void> {
  const session = await currentSession();
  if (!session) redirect('/login');

  const url = env().DATABASE_URL;
  if (!url) {
    logger.error('DATABASE_URL not set');
    redirect('/dashboard/drivers/new?error=Server%20not%20configured');
  }
  const { db } = getDb(url);
  const result = await createDriver(
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
        `/dashboard/drivers/new?error=${encodeURIComponent(
          'A driver with that WhatsApp number already exists.',
        )}`,
      );
    }
    const msg = result.issues
      .map((i) => `${i.path.join('.') || 'field'}: ${i.message}`)
      .slice(0, 3)
      .join('; ');
    redirect(`/dashboard/drivers/new?error=${encodeURIComponent(msg)}`);
  }
  redirect('/dashboard/drivers');
}
