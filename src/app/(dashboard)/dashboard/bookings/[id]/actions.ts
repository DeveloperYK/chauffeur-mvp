'use server';

import { currentSession } from '@/server/auth/current';
import {
  appUrl,
  db,
  driverLinkSecret,
  notifications,
  spreadsheetMirror,
} from '@/server/composition';
import {
  approveBooking,
  generateCompletionLink,
  rejectBooking,
} from '@/server/services/completion';
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
    mirror: spreadsheetMirror(),
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

export async function generateCompletionLinkAction(formData: FormData): Promise<void> {
  const session = await currentSession();
  if (!session) redirect('/login');
  const bookingId = String(formData.get('bookingId') ?? '');
  if (!bookingId) redirect('/dashboard');

  const result = await generateCompletionLink(bookingId, session.operator.id, {
    db: db(),
    secret: driverLinkSecret(),
    appUrl: appUrl(),
    mirror: spreadsheetMirror(),
  });

  if (!result.ok) {
    redirect(`/dashboard/bookings/${bookingId}?error=${encodeURIComponent(result.reason)}`);
  }
  const q = new URLSearchParams({ url: result.url, wa: result.whatsappUrl });
  redirect(`/dashboard/bookings/${bookingId}?${q.toString()}`);
}

export async function approveAction(formData: FormData): Promise<void> {
  const session = await currentSession();
  if (!session) redirect('/login');
  const bookingId = String(formData.get('bookingId') ?? '');
  if (!bookingId) redirect('/dashboard');
  await approveBooking(bookingId, session.operator.id, {
    db: db(),
    secret: driverLinkSecret(),
    appUrl: appUrl(),
    mirror: spreadsheetMirror(),
  });
  redirect(`/dashboard/bookings/${bookingId}`);
}

export async function rejectAction(formData: FormData): Promise<void> {
  const session = await currentSession();
  if (!session) redirect('/login');
  const bookingId = String(formData.get('bookingId') ?? '');
  if (!bookingId) redirect('/dashboard');
  await rejectBooking(bookingId, session.operator.id, {
    db: db(),
    secret: driverLinkSecret(),
    appUrl: appUrl(),
    mirror: spreadsheetMirror(),
  });
  redirect(`/dashboard/bookings/${bookingId}`);
}
