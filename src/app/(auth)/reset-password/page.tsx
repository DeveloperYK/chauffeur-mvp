import { Alert } from '@/components/ui/alert';
import Link from 'next/link';
import { BrandMark } from '../login/brand-mark';
import { ResetPasswordForm } from './reset-password-form';
import { resetTokenSchema } from './schema';

export const dynamic = 'force-dynamic';

/** Errors that mean the link itself is dead: show a "request a new one" screen. */
const DEAD_LINK_ERRORS = new Set(['invalid_token', 'expired_token']);

const deadLinkMessages: Record<string, string> = {
  invalid_token: 'This reset link is no longer valid. It may have been used already.',
  expired_token: 'This reset link has expired. Links are valid for 30 minutes.',
  missing: 'This reset link is incomplete. Open the link from your email again.',
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const params = await searchParams;
  const year = new Date().getFullYear();
  const tokenOk = resetTokenSchema.safeParse(params.token);
  const deadCode = !tokenOk.success
    ? 'missing'
    : params.error && DEAD_LINK_ERRORS.has(params.error)
      ? params.error
      : null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-sunken px-6 py-12">
      <div className="w-full max-w-sm animate-fade-in-up">
        <div className="mb-8">
          <BrandMark tone="dark" />
        </div>

        <div className="rounded-2xl border border-border bg-surface p-7 shadow-card sm:p-8">
          <h1 className="text-xl font-semibold tracking-tight text-ink">Choose a new password</h1>
          <p className="mt-1 text-sm text-ink-muted">
            You&apos;ll be signed out everywhere and can sign in with the new password.
          </p>
          <div className="mt-6">
            {deadCode ? (
              <div className="flex flex-col gap-4">
                <Alert tone="danger">{deadLinkMessages[deadCode]}</Alert>
                <Link
                  href="/forgot-password"
                  className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-gradient-to-b from-[#17294c] to-[#0b1733] text-sm font-semibold text-white"
                >
                  Request a new link
                </Link>
              </div>
            ) : (
              <ResetPasswordForm
                token={tokenOk.success ? tokenOk.data : ''}
                errorCode={params.error}
              />
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
