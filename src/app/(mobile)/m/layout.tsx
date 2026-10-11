import { currentSession } from '@/server/auth/current';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import '@/app/console.css';
import '@/app/mobile.css';

export const dynamic = 'force-dynamic';

/**
 * The mobile shell: the phone-sized console for an operator who is out and
 * has to handle a booking now. Same session rules as the board. See
 * docs/adr/0018-mobile-shell.md.
 */
export default async function MobileLayout({ children }: { children: ReactNode }) {
  const session = await currentSession();
  if (!session) redirect('/login');
  if (session.operator.mustChangePassword) redirect('/change-password');
  return <div className="m-app">{children}</div>;
}
