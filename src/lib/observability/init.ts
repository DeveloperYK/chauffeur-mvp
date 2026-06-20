import { scrubSentryEvent } from './scrub';

export interface SentryInitInput {
  /** DSN for this runtime (server uses SENTRY_DSN, client the NEXT_PUBLIC_ copy). */
  dsn: string | undefined;
  /** Deploy environment label (production / preview / development). */
  environment: string | undefined;
  /** Performance trace sample rate, 0..1. 0 = errors only. */
  tracesSampleRate: number;
}

/**
 * Common Sentry.init options shared by the server, edge, and client runtimes.
 *
 * Security posture (CLAUDE.md §6):
 *  - `enabled` is false unless a DSN is configured, so dev/test never phone home.
 *  - `sendDefaultPii: false` stops the SDK attaching IPs, cookies, and headers.
 *  - every outbound event and transaction passes through {@link scrubSentryEvent}
 *    as defence-in-depth against PII/secrets leaking through `extra`, URLs, etc.
 */
export function sentryInitOptions(input: SentryInitInput) {
  return {
    dsn: input.dsn,
    enabled: Boolean(input.dsn),
    environment: input.environment,
    tracesSampleRate: input.tracesSampleRate,
    sendDefaultPii: false,
    // `scrubSentryEvent` is a generic identity-shaped function, so it satisfies
    // both `beforeSend` (ErrorEvent) and `beforeSendTransaction` (TransactionEvent)
    // without naming their param types — those aren't re-exported by the SDK.
    beforeSend: scrubSentryEvent,
    beforeSendTransaction: scrubSentryEvent,
  };
}

/** Parse a 0..1 trace sample rate from an env string; defaults to 0 (errors only). */
export function parseSampleRate(raw: string | undefined): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return 0;
  return value > 1 ? 1 : value;
}
