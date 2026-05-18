'use client';

import { logger } from '@/lib/logger';
import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logger.error({ digest: error.digest, message: error.message }, 'unhandled UI error');
  }, [error]);

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
        <h1>Something went wrong</h1>
        <p style={{ color: '#94a3b8' }}>
          We've logged this. If it keeps happening, contact the operator-on-duty.
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            marginTop: '1rem',
            padding: '0.6rem 1rem',
            borderRadius: 6,
            background: '#2563eb',
            color: 'white',
            border: 'none',
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          Try again
        </button>
      </div>
    </main>
  );
}
