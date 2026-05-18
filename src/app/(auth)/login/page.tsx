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
    <main
      style={{
        display: 'flex',
        minHeight: '100vh',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'system-ui, sans-serif',
        background: '#0f172a',
        color: '#f8fafc',
      }}
    >
      <div
        style={{
          width: 380,
          padding: '2rem',
          borderRadius: 12,
          background: '#1e293b',
        }}
      >
        <h1 style={{ marginTop: 0 }}>Chauffeur Dispatch</h1>
        <p style={{ color: '#94a3b8' }}>Operator sign in</p>
        <LoginForm errorCode={errorCode} />
      </div>
    </main>
  );
}
