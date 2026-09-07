import type { ExecNotificationStatus } from '@/server/db/schema';

/**
 * The slice of a booking the "exec email due" rule needs. Timestamps are ISO
 * strings because this runs on the client against the console's serialised
 * booking shape. Mirrors `listEmailAttentionBookings` on the server.
 */
export interface ExecEmailDueInput {
  state: string;
  assignedDriverId: string | null;
  isBackfill: boolean;
  confirmationEmailSentAt: string | null;
  driverDetailsEmailSentAt: string | null;
  changeConfirmationStatus: string;
  changeExecRelevant: boolean;
  changeConfirmedAt: string | null;
  changeUpdateEmailSentAt: string | null;
}

/** States where a driver is on the job and both operator emails are expected. */
const EMAIL_EXPECTED_STATES: ReadonlySet<string> = new Set([
  'assigned',
  'in_progress',
  'awaiting_driver_form',
  'awaiting_operator_review',
]);

/**
 * Does the operator still owe the exec an email? True when a driver (or
 * backfill) is on the job but the confirmation and/or driver-details email
 * hasn't been sent, or a confirmed exec-relevant change has had no "Booking
 * update" email since. Cancelled bookings never owe anything.
 */
export function execEmailsDue(b: ExecEmailDueInput): boolean {
  if (b.state === 'cancelled') return false;
  const hasDriver = b.assignedDriverId != null || b.isBackfill;
  const bothDue =
    EMAIL_EXPECTED_STATES.has(b.state) &&
    hasDriver &&
    (!b.confirmationEmailSentAt || !b.driverDetailsEmailSentAt);
  const updateDue =
    b.changeConfirmationStatus === 'confirmed' &&
    b.changeExecRelevant &&
    b.changeConfirmedAt != null &&
    (!b.changeUpdateEmailSentAt || b.changeUpdateEmailSentAt < b.changeConfirmedAt);
  return bothDue || updateDue;
}

export interface ExecHealthLabel {
  tone: 'red' | 'orange' | 'green';
  label: string;
}

/**
 * Label for the panel's exec-health pill. Delivery health (`status`) alone
 * says "notified" as soon as one message lands, which misleads the operator
 * when the second email is still owed — so anything due outranks "ok" and
 * "pending". A failure always wins: it needs a resend before anything else.
 */
export function execHealthLabel(
  status: ExecNotificationStatus,
  due: boolean,
): ExecHealthLabel | null {
  if (status === 'failed') return { tone: 'red', label: 'EXEC MESSAGE FAILED' };
  if (due) return { tone: 'orange', label: 'EXEC EMAIL DUE' };
  if (status === 'pending') return { tone: 'orange', label: 'EXEC EMAIL PENDING' };
  if (status === 'ok') return { tone: 'green', label: 'EXEC NOTIFIED' };
  return null;
}
