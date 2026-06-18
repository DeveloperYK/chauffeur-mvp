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
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),
  // Resend (exec email channel). When both are set the real ResendEmailAdapter
  // is used; otherwise the in-memory FakeEmailAdapter (dev/test). RESEND_FROM
  // must be a verified sender/domain in production (sandbox onboarding@resend.dev
  // works for testing but only delivers to the account owner).
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM: z.string().optional(),
  GOOGLE_SHEETS_SPREADSHEET_ID: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
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
