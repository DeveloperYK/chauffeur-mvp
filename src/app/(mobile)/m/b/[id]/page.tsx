import { BookingScreen } from '@/components/mobile/booking-screen';
import { MobileTop } from '@/components/mobile/mobile-top';
import { bookingRef } from '@/lib/booking-ref';
import { formatLondonDay } from '@/lib/dates';
import { env } from '@/lib/env';
import { currentSession } from '@/server/auth/current';
import { getDb, resetDb } from '@/server/db';
import { DB_TIMEOUT_MS, withDbTimeout } from '@/server/db/timeout';
import { loadBookingView } from '@/server/services/console-view';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export default async function MobileBooking({ params }: { params: Promise<{ id: string }> }) {
  const session = await currentSession();
  if (!session) redirect('/login');
  const url = env().DATABASE_URL;
  if (!url) redirect('/m');
  const { db } = getDb(url);
  const { id } = await params;

  const view = await withDbTimeout(
    'mobile booking',
    DB_TIMEOUT_MS.page,
    () => loadBookingView(db, id),
    resetDb,
  );
  if (!view) redirect('/m');

  const day = formatLondonDay(new Date(view.booking.pickupAt));
  return (
    <>
      <MobileTop title={bookingRef(view.booking.seq)} backHref={`/m?date=${day}`} />
      <BookingScreen view={view} me={{ id: session.operator.id, name: session.operator.name }} />
    </>
  );
}
