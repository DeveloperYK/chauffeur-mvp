import { parseSampleRate, sentryInitOptions } from '@/lib/observability/init';
// Browser SDK init. Next.js loads this on the client; NEXT_PUBLIC_ vars are
// inlined at build time.
import * as Sentry from '@sentry/nextjs';

Sentry.init(
  sentryInitOptions({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    tracesSampleRate: parseSampleRate(process.env.SENTRY_TRACES_SAMPLE_RATE),
  }),
);

// Required for Sentry to trace App Router client-side navigations.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
