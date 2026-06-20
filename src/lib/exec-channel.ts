export type ExecNotificationChannel = 'sms' | 'email';

/**
 * The active exec-message channel — the single switch that moves all exec
 * traffic between SMS and email. SMS is the default and stays fully supported as
 * the fallback.
 *
 * Driven by `NEXT_PUBLIC_EXEC_NOTIFICATION_CHANNEL` (so both the server wrapper
 * and the client booking form read the same value) and defaults to `'sms'` when
 * unset — which keeps the whole test suite and local dev on SMS unless email is
 * explicitly turned on. To switch production to email, set
 * `NEXT_PUBLIC_EXEC_NOTIFICATION_CHANNEL=email` (plus `RESEND_API_KEY` and a
 * verified `RESEND_FROM`) and redeploy; revert by unsetting it. The value is
 * read at build time. See docs/shaping/exec-messages.
 */
export const EXEC_NOTIFICATION_CHANNEL: ExecNotificationChannel =
  process.env.NEXT_PUBLIC_EXEC_NOTIFICATION_CHANNEL === 'email' ? 'email' : 'sms';
