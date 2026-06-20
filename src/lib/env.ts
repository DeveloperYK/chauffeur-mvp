import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url().optional(),
  APP_URL: z.string().url().default('http://localhost:3000'),
  DRIVER_LINK_SECRET: z.string().min(32).optional(),
  // Shared secret for the /api/clock-tick scheduler endpoint. Optional: when
  // unset the clock loop is disabled. When present it must be long enough to
  // resist guessing — validated here so a misconfigured deploy fails fast.
  CLOCK_TICK_SECRET: z.string().min(16).optional(),
  // Secret used to authenticate Vercel Cron calls to GET /api/clock-tick. Vercel
  // injects this as `Authorization: Bearer <CRON_SECRET>` on every scheduled
  // invocation (the var MUST be named CRON_SECRET for that injection to happen).
  // Optional: when unset the GET endpoint reports the clock loop as disabled (503).
  CRON_SECRET: z.string().min(16).optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),
  // Resend (exec email channel). When both are set the real ResendEmailAdapter
  // is used; otherwise the in-memory FakeEmailAdapter (dev/test). RESEND_FROM
  // must be a verified sender/domain in production (sandbox onboarding@resend.dev
  // works for testing but only delivers to the account owner).
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM: z.string().optional(),
  // Signing secret for the Resend (Svix) delivery webhook. When unset the
  // webhook endpoint returns 503 (disabled). Format: `whsec_<base64>`.
  RESEND_WEBHOOK_SECRET: z.string().optional(),
  GOOGLE_SHEETS_SPREADSHEET_ID: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  // Sentry error tracking. When the DSN is unset the SDK initialises as a no-op
  // (dev/test capture nothing), so these are all optional. The server DSN is
  // read directly by the root `sentry.server.config.ts`; the client uses the
  // NEXT_PUBLIC_ copy (inlined at build time). SENTRY_ENVIRONMENT lets prod and
  // preview deploys be told apart; the trace sample rate defaults to 0 (errors
  // only, no performance tracing) and is clamped to 0..1.
  SENTRY_DSN: z.string().url().optional(),
  NEXT_PUBLIC_SENTRY_DSN: z.string().url().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).optional(),
  // When set (`true`/`1`), the operator login screen is bypassed and the app
  // auto-resolves to the first active operator in every environment — including
  // production. Reversible by flipping the env var; no code change needed.
  // SECURITY: leaves the dashboard open to anyone who can reach the URL. Gate
  // access another way (e.g. platform password protection) when this is on.
  AUTH_DISABLED: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  // When set (`true`/`1`), the operator-facing test simulator is available in
  // every environment — including production — so demo deploys can seed data,
  // advance the clock, and force state transitions. Off by default.
  SIMULATOR_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (cached) return cached;
  cached = schema.parse(process.env);
  return cached;
}
