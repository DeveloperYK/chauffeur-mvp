import { Rail } from '@/components/console/rail';
import { Topbar } from '@/components/console/topbar';
import { type ActionViewCounts, ZERO_COUNTS } from '@/lib/action-views';
import { env } from '@/lib/env';
import { currentSession } from '@/server/auth/current';
import { getDb } from '@/server/db';
import { simulatorEnabled } from '@/server/feature-flags';
import { countActionViews } from '@/server/services/action-views';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import '@/app/console.css';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await currentSession();
  if (!session) redirect('/login');
  // A seeded account with a one-time temp password must set a real one before
  // it can reach any console page.
  if (session.operator.mustChangePassword) redirect('/change-password');

  // Rail badges: one count per action view (see ADR 0021). A missing DB (build
  // time) renders zeros rather than failing the whole console.
  const url = env().DATABASE_URL;
  const counts: ActionViewCounts = url ? await countActionViews(getDb(url).db) : ZERO_COUNTS;

  return (
    <div className="app">
      <Topbar me={{ id: session.operator.id, name: session.operator.name }} />
      <Rail counts={counts} showSimulator={simulatorEnabled()} />
      <main className="main" style={{ overflowY: 'auto' }}>
        {children}
      </main>
    </div>
  );
}
