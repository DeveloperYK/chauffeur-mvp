'use server';

import { currentSession } from '@/server/auth/current';
import { appUrl, db, driverLinkSecret, notifications } from '@/server/composition';
import { generateDispatchLink } from '@/server/services/dispatch';
import { redirect } from 'next/navigation';

export async function generateLinkAction(formData: FormData): Promise<void> {
  const session = await currentSession();
  if (!session) redirect('/login');

  const bookingId = String(formData.get('bookingId') ?? '');
  const driverId = String(formData.get('driverId') ?? '');
  if (!bookingId || !driverId) {
    redirect(`/dashboard/bookings/${bookingId}?error=Missing%20parameters`);
  }

  const result = await generateDispatchLink(bookingId, driverId, session.operator.id, {
    db: db(),
    notifications: notifications(),
    secret: driverLinkSecret(),
    appUrl: appUrl(),
  });

  if (!result.ok) {
    const msg =
      result.reason === 'booking_not_found'
        ? 'Booking not found'
        : result.reason === 'driver_not_found'
          ? 'Driver not found'
          : result.reason === 'driver_inactive'
            ? 'Driver is inactive'
            : `Cannot dispatch from state: ${result.state}`;
    redirect(`/dashboard/bookings/${bookingId}?error=${encodeURIComponent(msg)}`);
  }

  const q = new URLSearchParams({
    url: result.url,
    wa: result.whatsappUrl,
  });
  redirect(`/dashboard/bookings/${bookingId}?${q.toString()}`);
}
