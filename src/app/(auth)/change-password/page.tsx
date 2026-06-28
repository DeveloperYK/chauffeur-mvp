import { currentSession } from '@/server/auth/current';
import { redirect } from 'next/navigation';
import { BrandMark } from '../login/brand-mark';
import { ChangePasswordForm } from './change-password-form';

export const dynamic = 'force-dynamic';

export default async function ChangePasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await currentSession();
  if (!session) redirect('/login');
  const params = await searchParams;
  const year = new Date().getFullYear();
  const forced = session.operator.mustChangePassword;

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-sunken px-6 py-12">
      <div className="w-full max-w-sm animate-fade-in-up">
        <div className="mb-8">
          <BrandMark tone="dark" />
        </div>

        <div className="rounded-2xl border border-border bg-surface p-7 shadow-card sm:p-8">
          <h1 className="text-xl font-semibold tracking-tight text-ink">Set a new password</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {forced
              ? 'Your account was created with a temporary password. Choose a new one to finish signing in.'
              : 'Update the password for your operator account.'}
          </p>
          <div className="mt-6">
            <ChangePasswordForm errorCode={params.error} forced={forced} />
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-ink-muted">
          © {year} JJ Chauffeuring · Operator Console
        </p>
      </div>
    </main>
  );
}
