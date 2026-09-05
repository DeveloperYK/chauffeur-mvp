import { Rail, type SavedView } from '@/components/console/rail';
import { Topbar } from '@/components/console/topbar';
import { env } from '@/lib/env';
import { currentSession } from '@/server/auth/current';
import { getDb } from '@/server/db';
import { bookings } from '@/server/db/schema';
import { simulatorEnabled } from '@/server/feature-flags';
import { driverNotToldConditions } from '@/server/services/bookings-query';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import '@/app/console.css';

export const dynamic = 'force-dynamic';

const SAVED_VIEWS: SavedView[] = [
  { id: 'unassigned', name: 'Unassigned tickets', vdot: '#8590A2' },
  { id: 'needs_review', name: 'Awaiting review', vdot: '#5243AA', urgent: true },
  // Bookings still missing a contract price — they block the monthly invoice,
  // so the rail keeps a running count until an operator prices them.
  { id: 'no_price', name: 'No price', vdot: '#E56910', urgent: true },
  // Dispatched bookings edited after the driver was told, still awaiting the
  // driver's confirmation of the new plan. Must be loud: a driver working off
  // stale details is an operational failure.
  { id: 'driver_not_told', name: 'Driver not told', vdot: '#C9372C', urgent: true },
];

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await currentSession();
  if (!session) redirect('/login');
  // A seeded account with a one-time temp password must set a real one before
  // it can reach any console page.
  if (session.operator.mustChangePassword) redirect('/change-password');

  const counts: Record<string, number> = {
    unassigned: 0,
    needs_review: 0,
    no_price: 0,
    driver_not_told: 0,
  };
  const url = env().DATABASE_URL;
  if (url) {
    const { db } = getDb(url);
    const [u, r, p, d] = await Promise.all([
      db.select({ id: bookings.id }).from(bookings).where(eq(bookings.state, 'unassigned')),
      db
        .select({ id: bookings.id })
        .from(bookings)
        .where(eq(bookings.state, 'awaiting_operator_review')),
      // Same definition as listUnpricedBookings: no contract price yet, and
      // not cancelled (cancelled bookings are never invoiced).
      db
        .select({ id: bookings.id })
        .from(bookings)
        .where(and(isNull(bookings.contractPricePence), ne(bookings.state, 'cancelled'))),
      db
        .select({ id: bookings.id })
        .from(bookings)
        .where(and(...driverNotToldConditions())),
    ]);
    counts.unassigned = u.length;
    counts.needs_review = r.length;
    counts.no_price = p.length;
    counts.driver_not_told = d.length;
  }

  return (
    <div className="app">
      <Topbar me={{ id: session.operator.id, name: session.operator.name }} />
      <Rail savedViews={SAVED_VIEWS} counts={counts} showSimulator={simulatorEnabled()} />
      <main className="main" style={{ overflowY: 'auto' }}>
        {children}
      </main>
    </div>
  );
}
