import { currentSession } from '@/server/auth/current';
import { redirect } from 'next/navigation';
import { BrandMark } from './brand-mark';
import { LoginForm } from './login-form';
import { LoginHero } from './login-hero';

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
  const year = new Date().getFullYear();

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_minmax(0,0.9fr)]">
      <LoginHero />

      <div className="relative flex min-h-screen items-center justify-center bg-surface-sunken px-6 py-12">
        <div className="w-full max-w-sm animate-fade-in-up">
          {/* Brand lockup for small screens, where the hero panel is hidden. */}
          <div className="mb-8 lg:hidden">
            <BrandMark tone="dark" />
          </div>

          <div className="rounded-2xl border border-border bg-surface p-7 shadow-card sm:p-8">
            <h1 className="text-xl font-semibold tracking-tight text-ink">Welcome back</h1>
            <p className="mt-1 text-sm text-ink-muted">Sign in to the operator console.</p>
            <div className="mt-6">
              <LoginForm errorCode={errorCode} />
            </div>
          </div>

          <p className="mt-6 text-center text-xs text-ink-muted">
            © {year} JJ Chauffeuring · Operator Console
          </p>
        </div>
      </div>
    </main>
  );
}
