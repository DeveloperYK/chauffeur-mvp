import { currentSession } from '@/server/auth/current';
import { redirect } from 'next/navigation';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await currentSession();
  if (session) redirect('/dashboard');
  const params = await searchParams;
  const errorCode = params.error;

  return (
    <main className="grid min-h-screen place-items-center bg-surface-sunken p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded bg-brand-700 text-sm font-bold text-white">
            CD
          </span>
          <span className="text-base font-semibold text-ink">Chauffeur Dispatch</span>
        </div>
        <div className="rounded-lg border border-border bg-surface p-6 shadow-card">
          <h1 className="mb-1 text-lg font-semibold text-ink">Sign in</h1>
          <p className="mb-4 text-sm text-ink-muted">Operator console</p>
          <LoginForm errorCode={errorCode} />
        </div>
      </div>
    </main>
  );
}
