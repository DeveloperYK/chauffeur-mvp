import { currentSession } from '@/server/auth/current';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await currentSession();
  if (!session) redirect('/login');
  return (
    <div
      style={{
        minHeight: '100vh',
        fontFamily: 'system-ui, sans-serif',
        background: '#f8fafc',
        color: '#0f172a',
      }}
    >
      <header
        style={{
          padding: '1rem 1.5rem',
          borderBottom: '1px solid #e2e8f0',
          background: 'white',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'baseline' }}>
          <strong>Chauffeur Dispatch</strong>
          <a href="/dashboard" style={{ color: '#0f172a', textDecoration: 'none' }}>
            Board
          </a>
          <a href="/dashboard/drivers" style={{ color: '#0f172a', textDecoration: 'none' }}>
            Drivers
          </a>
        </div>
        <span style={{ fontSize: 14, color: '#64748b' }}>{session.operator.name}</span>
      </header>
      <main style={{ padding: '1.5rem' }}>{children}</main>
    </div>
  );
}
