import { type NavItem, Sidebar } from '@/components/ui/nav';
import { currentSession } from '@/server/auth/current';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await currentSession();
  if (!session) redirect('/login');

  const items: NavItem[] = [
    { href: '/dashboard', label: 'Board', icon: '▦' },
    { href: '/dashboard/calendar', label: 'Calendar', icon: '🗓' },
    { href: '/dashboard/drivers', label: 'Drivers', icon: '◉' },
  ];
  if (process.env.NODE_ENV !== 'production') {
    items.push({ href: '/dashboard/simulator', label: 'Simulator', icon: '⚙' });
  }

  return (
    <div className="flex h-full min-h-screen bg-surface-sunken">
      <Sidebar items={items} operatorName={session.operator.name} />
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
