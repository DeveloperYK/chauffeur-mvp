import { Rail, type SavedView } from '@/components/console/rail';
import { Topbar } from '@/components/console/topbar';
import { env } from '@/lib/env';
import { currentSession } from '@/server/auth/current';
import { getDb } from '@/server/db';
import { bookings } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import '@/app/console.css';

export const dynamic = 'force-dynamic';

const SAVED_VIEWS: SavedView[] = [
  { id: 'unassigned', name: 'Unassigned tickets', vdot: '#8590A2' },
  { id: 'needs_review', name: 'Awaiting review', vdot: '#5243AA', urgent: true },
];

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await currentSession();
  if (!session) redirect('/login');

  const counts: Record<string, number> = { unassigned: 0, needs_review: 0 };
  const url = env().DATABASE_URL;
  if (url) {
    const { db } = getDb(url);
    const [u, r] = await Promise.all([
      db.select({ id: bookings.id }).from(bookings).where(eq(bookings.state, 'unassigned')),
      db
        .select({ id: bookings.id })
        .from(bookings)
        .where(eq(bookings.state, 'awaiting_operator_review')),
    ]);
    counts.unassigned = u.length;
    counts.needs_review = r.length;
  }

  return (
    <div className="app">
      <Topbar me={{ id: session.operator.id, name: session.operator.name }} />
      <Rail
        savedViews={SAVED_VIEWS}
        counts={counts}
        showSimulator={env().NODE_ENV !== 'production'}
      />
      <main className="main" style={{ overflowY: 'auto' }}>
        {children}
      </main>
    </div>
  );
}
