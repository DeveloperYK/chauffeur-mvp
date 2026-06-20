import { parseSampleRate, sentryInitOptions } from '@/lib/observability/init';
// Runs in the Node.js runtime (loaded by instrumentation.ts `register`).
import * as Sentry from '@sentry/nextjs';

Sentry.init(
  sentryInitOptions({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    tracesSampleRate: parseSampleRate(process.env.SENTRY_TRACES_SAMPLE_RATE),
  }),
);
