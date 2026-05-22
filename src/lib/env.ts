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
  GOOGLE_SHEETS_SPREADSHEET_ID: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (cached) return cached;
  cached = schema.parse(process.env);
  return cached;
}
