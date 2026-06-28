import { formatLondonDay } from '@/lib/dates';
import { env } from '@/lib/env';
import { currentSession } from '@/server/auth/current';
import { getDb } from '@/server/db';
import { bookings } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * The standalone booking detail page has been consolidated into the board's
 * detail panel (the single, richer operator surface — find a driver, hand to
 * backfill, edit, cancel, exec messages, history). This route now resolves the
 * booking's London pickup day and redirects to the board with that booking's
 * panel open (`?date=<day>&booking=<id>`), so old links, bookmarks and search
 * results keep working without a second, divergent surface.
 */
export default async function BookingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await currentSession();
  if (!session) redirect('/login');

  const url = env().DATABASE_URL;
  if (!url) redirect('/dashboard');
  const { db } = getDb(url);
  const [booking] = await db.select().from(bookings).where(eq(bookings.id, id)).limit(1);
  if (!booking) redirect('/dashboard');

  const day = formatLondonDay(booking.pickupAt);
  redirect(`/dashboard?date=${day}&booking=${id}`);
}
