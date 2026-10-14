import { Alert } from '@/components/ui/alert';
import Link from 'next/link';
import { BrandMark } from '../login/brand-mark';
import { ForgotPasswordForm } from './forgot-password-form';

export const dynamic = 'force-dynamic';

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string }>;
}) {
  const params = await searchParams;
  const sent = params.sent === '1';
  const year = new Date().getFullYear();

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-sunken px-6 py-12">
      <div className="w-full max-w-sm animate-fade-in-up">
        <div className="mb-8">
          <BrandMark tone="dark" />
        </div>

        <div className="rounded-2xl border border-border bg-surface p-7 shadow-card sm:p-8">
          <h1 className="text-xl font-semibold tracking-tight text-ink">Forgot your password?</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Enter your email and we&apos;ll send you a link to choose a new one.
          </p>
          <div className="mt-6">
            {sent ? (
              <Alert tone="success">
                If that email belongs to an operator account, a reset link is on its way. It expires
                in 30 minutes.
              </Alert>
            ) : (
              <ForgotPasswordForm errorCode={params.error} />
            )}
          </div>
          <p className="mt-5 text-center text-sm text-ink-muted">
            <Link href="/login" className="font-medium text-ink underline-offset-4 hover:underline">
              Back to sign in
            </Link>
          </p>
        </div>

        <p className="mt-6 text-center text-xs text-ink-muted">
          © {year} JJ Chauffeuring · Operator Console
        </p>
      </div>
    </main>
  );
}
