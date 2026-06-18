export type ExecNotificationChannel = 'sms' | 'email';

/**
 * The active exec-message channel. A deliberate code-level switch — not env- or
 * runtime-configurable — so moving all exec traffic between SMS and email is one
 * reviewed line change plus a deploy, and reverts the same way. SMS is the
 * default and stays fully supported.
 *
 * Lives in `lib` (no server imports) so both the server wrapper and the client
 * booking form can read it to decide routing / which contact field to require.
 * See docs/shaping/exec-messages.
 */
export const EXEC_NOTIFICATION_CHANNEL: ExecNotificationChannel = 'sms';
