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

export type ExecEmailRow = {
  kind: 'assigned' | 'en_route' | 'changed';
  title: string;
  sentAt: string | null;
  canSend: boolean;
  disabledHint: string | null;
  flagged: boolean;
};

/**
 * The send rows the "Exec emails" card shows for a booking, derived purely
 * from its state. Same input slice as `execEmailsDue`, so the card, the tile
 * tag and the hero pill can never disagree about what is owed.
 */
export function execEmailRows(booking: ExecEmailDueInput): ExecEmailRow[] {
  const hasDriver = Boolean(booking.assignedDriverId) || booking.isBackfill;
  const flagActive = EMAIL_EXPECTED_STATES.has(booking.state);
  const cancelled = booking.state === 'cancelled';
  // A confirmed exec-relevant change needs a "Booking update" email until one
  // is sent after the confirmation.
  const updateDue =
    booking.changeConfirmationStatus === 'confirmed' &&
    booking.changeExecRelevant &&
    booking.changeConfirmedAt != null &&
    (!booking.changeUpdateEmailSentAt ||
      booking.changeUpdateEmailSentAt < booking.changeConfirmedAt) &&
    !cancelled;
  return [
    {
      kind: 'assigned',
      title: '1 · Booking confirmation',
      sentAt: booking.confirmationEmailSentAt,
      canSend: !cancelled,
      disabledHint: null,
      flagged: flagActive && hasDriver && !booking.confirmationEmailSentAt,
    },
    {
      kind: 'en_route',
      title: '2 · Driver details',
      sentAt: booking.driverDetailsEmailSentAt,
      canSend: !cancelled && hasDriver,
      disabledHint: hasDriver ? null : 'Needs a driver on the job',
      flagged: flagActive && hasDriver && !booking.driverDetailsEmailSentAt,
    },
    // The update row only appears once a mid-flight change makes it relevant
    // (or one was already sent).
    ...(updateDue || booking.changeUpdateEmailSentAt
      ? [
          {
            kind: 'changed' as const,
            title: '3 · Booking update',
            sentAt: updateDue ? null : booking.changeUpdateEmailSentAt,
            canSend: !cancelled,
            disabledHint: null,
            flagged: updateDue,
          },
        ]
      : []),
  ];
}
