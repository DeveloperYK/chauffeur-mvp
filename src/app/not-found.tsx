import Link from 'next/link';

export default function NotFound() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
        fontFamily: 'system-ui, sans-serif',
        background: '#0f172a',
        color: '#f8fafc',
      }}
    >
      <div style={{ maxWidth: 480, textAlign: 'center' }}>
        <h1>Not found</h1>
        <p style={{ color: '#94a3b8' }}>That page doesn't exist.</p>
        <p>
          <Link href="/" style={{ color: '#60a5fa' }}>
            Back to start
          </Link>
        </p>
      </div>
    </main>
  );
}
