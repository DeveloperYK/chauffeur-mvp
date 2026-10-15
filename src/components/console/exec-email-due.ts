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
  /** "Mark as handled" stamps — a waived email counts as settled, like a sent one. */
  confirmationEmailWaivedAt: string | null;
  driverDetailsEmailWaivedAt: string | null;
  changeUpdateEmailWaivedAt: string | null;
}

/** A change-update email is settled by a send or a waiver made since the confirmation. */
function updateEmailSettled(b: ExecEmailDueInput): boolean {
  const confirmedAt = b.changeConfirmedAt;
  if (confirmedAt == null) return true;
  return [b.changeUpdateEmailSentAt, b.changeUpdateEmailWaivedAt].some(
    (at) => at != null && at >= confirmedAt,
  );
}

function updateEmailDue(b: ExecEmailDueInput): boolean {
  return (
    b.changeConfirmationStatus === 'confirmed' &&
    b.changeExecRelevant &&
    b.changeConfirmedAt != null &&
    !updateEmailSettled(b)
  );
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
  const confirmationSettled = Boolean(b.confirmationEmailSentAt || b.confirmationEmailWaivedAt);
  const detailsSettled = Boolean(b.driverDetailsEmailSentAt || b.driverDetailsEmailWaivedAt);
  const bothDue =
    EMAIL_EXPECTED_STATES.has(b.state) && hasDriver && !(confirmationSettled && detailsSettled);
  return bothDue || updateEmailDue(b);
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
  /** Set when the operator marked this email as handled (and no send supersedes it). */
  waivedAt: string | null;
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
  const updateDue = updateEmailDue(booking) && !cancelled;
  // The update row's waiver only counts if it was made since the confirmation.
  const updateWaivedAt =
    booking.changeConfirmedAt != null &&
    booking.changeUpdateEmailWaivedAt != null &&
    booking.changeUpdateEmailWaivedAt >= booking.changeConfirmedAt
      ? booking.changeUpdateEmailWaivedAt
      : null;
  return [
    {
      kind: 'assigned',
      title: '1 · Booking confirmation',
      sentAt: booking.confirmationEmailSentAt,
      waivedAt: booking.confirmationEmailWaivedAt,
      canSend: !cancelled,
      disabledHint: null,
      flagged:
        flagActive &&
        hasDriver &&
        !booking.confirmationEmailSentAt &&
        !booking.confirmationEmailWaivedAt,
    },
    {
      kind: 'en_route',
      title: '2 · Driver details',
      sentAt: booking.driverDetailsEmailSentAt,
      waivedAt: booking.driverDetailsEmailWaivedAt,
      canSend: !cancelled && hasDriver,
      disabledHint: hasDriver ? null : 'Needs a driver on the job',
      flagged:
        flagActive &&
        hasDriver &&
        !booking.driverDetailsEmailSentAt &&
        !booking.driverDetailsEmailWaivedAt,
    },
    // The update row only appears once a mid-flight change makes it relevant
    // (or one was already sent / handled).
    ...(updateDue || booking.changeUpdateEmailSentAt || updateWaivedAt
      ? [
          {
            kind: 'changed' as const,
            title: '3 · Booking update',
            sentAt: updateDue ? null : booking.changeUpdateEmailSentAt,
            waivedAt: updateDue ? null : updateWaivedAt,
            canSend: !cancelled,
            disabledHint: null,
            flagged: updateDue,
          },
        ]
      : []),
  ];
}
