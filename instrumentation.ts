import * as Sentry from '@sentry/nextjs';

// Next.js calls register() once per server runtime on boot. We import the
// matching Sentry config so the SDK initialises before any request is handled.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

// Captures errors thrown in App Router server components / route handlers.
export const onRequestError = Sentry.captureRequestError;
