/**
 * Exec-message wrapper: the single choke point through which every automated
 * message to the exec is sent AND recorded. Before this, callers fired
 * `NotificationPort.sendSms` and threw the result away, so a failed send was
 * invisible. Now each attempt writes a row to `exec_notifications` (success or
 * failure) and refreshes the cached `bookings.exec_notification_status` the
 * board reads, so operators can see what the exec was told and catch silent
 * failures.
 *
 * Persistence is best-effort and decoupled from the send: the provider call
 * happens first; a logging/DB error afterwards is caught and logged, never
 * propagated, so it can't break the (already-committed) state transition that
 * triggered the message. See docs/shaping/exec-messages.
 *
 * The active channel (SMS or email) is chosen by EXEC_NOTIFICATION_CHANNEL and
 * the recipient + renderer are picked to match. SMS is accepted-only; an email
 * is accepted now (row `sent` → cached `pending`) and confirmed later by webhook
 * (V3). If the active channel has no recipient on file, a loud `failed` row is
 * written and no provider call is made — never a silent drop.
 */
import { EXEC_NOTIFICATION_CHANNEL, type ExecNotificationChannel } from '@/lib/exec-channel';
import { carDescription } from '@/lib/labels';
import { logger } from '@/lib/logger';
import type { Database } from '@/server/db';
import {
  type ExecNotification,
  type NewExecNotification,
  type NotificationKind,
  bookings,
  drivers,
  execNotifications,
} from '@/server/db/schema';
import { type LatestMessage, rollupExecStatus } from '@/server/domain/exec-notifications';
import type { EmailPort } from '@/server/ports/email';
import type { NotificationPort } from '@/server/ports/notifications';
import { and, asc, desc, eq, inArray, isNotNull, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { recordAuditEvent } from './audit';
import {
  type RenderedEmail,
  assignedEmail,
  changeExecEmail,
  driverDetailsEmail,
  renderCustomExecEmail,
} from './email-templates';
import { assignedSms, changeExecSms, enRouteSms } from './sms-templates';

export { EXEC_NOTIFICATION_CHANNEL };

export interface ExecNotificationDeps {
  db: Database;
  notifications: NotificationPort;
  /** Required when the active channel is email; unused for SMS. */
  email?: EmailPort | undefined;
  /**
   * Override the active channel for this call. Production never sets this — it
   * defaults to EXEC_NOTIFICATION_CHANNEL. Exists so tests can exercise the
   * email branch without mocking the module constant.
   */
  channel?: ExecNotificationChannel | undefined;
}

/**
 * Everything needed to render an exec message, independent of channel. `car`
 * (colour + car description) is only used by the `assigned` message; `en_route`
 * just names the driver. Backfill drivers have no `drivers` row, so the caller
 * passes the operator-entered name/car straight through.
 */
export interface ExecMessageContext {
  booking: typeof bookings.$inferSelect;
  kind: NotificationKind;
  driverName: string;
  car?: string;
  /** Registration plate, shown to the exec in the email (internal drivers only). */
  plate?: string | null;
  /** PCO licence number, shown to the exec in the email (internal drivers only). */
  pcoNumber?: string | null;
  /** Driver's contact number, shown to the exec in the email. */
  driverPhone?: string | null;
}

interface SendOutcome {
  status: ExecNotification['status'];
  providerMessageId: string | null;
  errorReason: string | null;
}

function renderSmsBody(ctx: ExecMessageContext): string {
  if (ctx.kind === 'assigned') {
    return assignedSms(ctx.booking, { name: ctx.driverName }, ctx.car ?? '');
  }
  if (ctx.kind === 'changed') {
    return changeExecSms(ctx.booking);
  }
  return enRouteSms(ctx.booking, { name: ctx.driverName });
}

function renderEmail(ctx: ExecMessageContext): RenderedEmail {
  const driver = { name: ctx.driverName, pcoNumber: ctx.pcoNumber, phone: ctx.driverPhone };
  if (ctx.kind === 'assigned') {
    return assignedEmail(ctx.booking, driver, ctx.car ?? '', ctx.plate);
  }
  if (ctx.kind === 'changed') {
    return changeExecEmail(ctx.booking);
  }
  return driverDetailsEmail(ctx.booking, driver, ctx.car ?? '', ctx.plate);
}

async function performSmsSend(
  notifications: NotificationPort,
  to: string,
  body: string,
): Promise<SendOutcome> {
  try {
    const res = await notifications.sendSms({ to, body });
    if (res.ok) return { status: 'sent', providerMessageId: res.id, errorReason: null };
    return { status: 'failed', providerMessageId: null, errorReason: res.reason };
  } catch (err) {
    logger.error({ err }, 'exec sms send threw');
    return { status: 'failed', providerMessageId: null, errorReason: 'exception' };
  }
}

async function performEmailSend(
  email: EmailPort,
  to: string,
  subject: string,
  text: string,
  html: string,
): Promise<SendOutcome> {
  try {
    const res = await email.sendEmail({ to, subject, text, html });
    if (res.ok) return { status: 'sent', providerMessageId: res.id, errorReason: null };
    return { status: 'failed', providerMessageId: null, errorReason: res.reason };
  } catch (err) {
    logger.error({ err }, 'exec email send threw');
    return { status: 'failed', providerMessageId: null, errorReason: 'exception' };
  }
}

/**
 * Resolve the active channel + recipient + rendered message, send it, and return
 * the row to persist. No-contact guard: if the active channel has no recipient
 * on file (email mode, no `exec_email`), no provider call is made and a `failed`
 * row is returned (loud, never silent). Shared by initial send and resend.
 */
async function sendOnActiveChannel(
  deps: ExecNotificationDeps,
  ctx: ExecMessageContext,
): Promise<NewExecNotification> {
  const channel = deps.channel ?? EXEC_NOTIFICATION_CHANNEL;
  const base = { bookingId: ctx.booking.id, channel, kind: ctx.kind };

  if (channel === 'email') {
    const to = ctx.booking.execEmail ?? '';
    const { subject, html, text } = renderEmail(ctx);
    if (!to) {
      return {
        ...base,
        to: '',
        subject,
        body: text,
        status: 'failed',
        providerMessageId: null,
        errorReason: 'no_email',
      };
    }
    if (!deps.email) {
      return {
        ...base,
        to,
        subject,
        body: text,
        status: 'failed',
        providerMessageId: null,
        errorReason: 'email_not_configured',
      };
    }
    const outcome = await performEmailSend(deps.email, to, subject, text, html);
    return { ...base, to, subject, body: text, ...outcome };
  }

  // SMS (default). execMobile is required at booking creation, but guard anyway.
  const to = ctx.booking.execMobile;
  const body = renderSmsBody(ctx);
  if (!to) {
    return {
      ...base,
      to: '',
      subject: null,
      body,
      status: 'failed',
      providerMessageId: null,
      errorReason: 'no_mobile',
    };
  }
  const outcome = await performSmsSend(deps.notifications, to, body);
  return { ...base, to, subject: null, body, ...outcome };
}

/** Latest non-superseded message per kind → cached booking status. */
async function computeRollup(db: Database, bookingId: string) {
  const rows = await db
    .select({
      channel: execNotifications.channel,
      status: execNotifications.status,
      kind: execNotifications.kind,
    })
    .from(execNotifications)
    .where(
      and(eq(execNotifications.bookingId, bookingId), ne(execNotifications.status, 'superseded')),
    )
    .orderBy(desc(execNotifications.createdAt));

  const seen = new Set<NotificationKind>();
  const latest: LatestMessage[] = [];
  for (const r of rows) {
    if (seen.has(r.kind)) continue;
    seen.add(r.kind);
    latest.push({ channel: r.channel, status: r.status });
  }
  return rollupExecStatus(latest);
}

/**
 * Insert the attempt row and refresh the cached column. Optionally supersede a
 * prior row first (resend). Best-effort: any failure here is logged and
 * swallowed (returns null) so it cannot break the caller's send path. The
 * rollup recomputes from all live rows, so the cache self-heals on the next
 * write even if one update is lost.
 */
async function persistAttempt(
  db: Database,
  values: NewExecNotification,
  supersedeId?: string,
): Promise<ExecNotification | null> {
  try {
    if (supersedeId) {
      await db
        .update(execNotifications)
        .set({ status: 'superseded', updatedAt: sql`now()` })
        .where(eq(execNotifications.id, supersedeId));
    }
    const [row] = await db.insert(execNotifications).values(values).returning();
    const cached = await computeRollup(db, values.bookingId);
    await db
      .update(bookings)
      .set({ execNotificationStatus: cached })
      .where(eq(bookings.id, values.bookingId));
    return row ?? null;
  } catch (err) {
    logger.error({ err, bookingId: values.bookingId }, 'failed to persist exec notification');
    return null;
  }
}

/**
 * Send one exec message on the active channel and record it. Returns the
 * persisted row, or null if persistence failed (the send may still have
 * happened — callers treat this as fire-and-forget).
 */
export async function sendExecNotification(
  deps: ExecNotificationDeps,
  ctx: ExecMessageContext,
): Promise<ExecNotification | null> {
  const values = await sendOnActiveChannel(deps, ctx);
  return persistAttempt(deps.db, values);
}

export type NotifyExecChangeResult =
  | { ok: true; notification: ExecNotification }
  | { ok: false; reason: 'booking_not_found' | 'no_driver' | 'no_email' | 'persist_failed' };

/**
 * Tell the exec a change to their booking has been confirmed, restating the
 * current plan. **Email only** — regardless of the global channel switch, a
 * change notification never goes by SMS (there's no value in a terse SMS for a
 * detail change). Recorded as a `changed` exec notification so the board health
 * roll-up tracks it. Fired automatically when an exec-relevant change is
 * confirmed (see confirmChange* in change-confirmation). No-ops (no_email) when
 * the booking has no exec email on file. See docs/shaping/mid-flight-changes.
 */
export async function notifyExecOfChange(
  deps: ExecNotificationDeps,
  bookingId: string,
): Promise<NotifyExecChangeResult> {
  const [booking] = await deps.db
    .select()
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);
  if (!booking) return { ok: false, reason: 'booking_not_found' };
  // Email-only: skip silently when there's no address rather than writing a
  // failed SMS-less attempt.
  if (!booking.execEmail) return { ok: false, reason: 'no_email' };

  const ctx = await buildExecContextForBooking(deps.db, booking, 'changed');
  if (!ctx) return { ok: false, reason: 'no_driver' };

  // Force the email channel for this notification, whatever the global switch is.
  const row = await sendExecNotification({ ...deps, channel: 'email' }, ctx);
  if (!row) return { ok: false, reason: 'persist_failed' };
  return { ok: true, notification: row };
}

/**
 * Build the render context from a booking + its already-loaded driver row.
 * Single source of truth for which driver fields the exec sees (name, car,
 * plate, PCO number, contact number) — used by accept/assign/swap/en-route
 * sends and by the rebuild path below.
 */
export function execContextFromDriver(
  booking: typeof bookings.$inferSelect,
  kind: NotificationKind,
  driver: typeof drivers.$inferSelect,
): ExecMessageContext {
  return {
    booking,
    kind,
    driverName: driver.name,
    car: carDescription(driver.car, driver.carColour),
    plate: driver.numberPlate,
    pcoNumber: driver.pcoNumber,
    driverPhone: driver.whatsappNumber,
  };
}

/** Rebuild the render context from the booking's CURRENT driver/backfill state. */
export async function buildExecContextForBooking(
  db: Database,
  booking: typeof bookings.$inferSelect,
  kind: NotificationKind,
): Promise<ExecMessageContext | null> {
  if (booking.assignedDriverId) {
    const [driver] = await db
      .select()
      .from(drivers)
      .where(eq(drivers.id, booking.assignedDriverId))
      .limit(1);
    if (driver) return execContextFromDriver(booking, kind, driver);
  }
  if (booking.isBackfill && booking.backfillDriverName) {
    return {
      booking,
      kind,
      driverName: booking.backfillDriverName,
      car: booking.backfillCar ?? '',
      driverPhone: booking.backfillDriverPhone,
    };
  }
  return null;
}

export type ResendResult =
  | { ok: true; notification: ExecNotification }
  | { ok: false; reason: 'not_found' | 'no_driver' | 'persist_failed' };

/**
 * Re-send a failed/bounced exec message. The body is rebuilt from the booking's
 * CURRENT state (not a stale replay) so the exec gets correct information now,
 * sent over the active channel. The old row is marked `superseded`; on success
 * the cached status clears automatically via the recomputed roll-up.
 */
export async function resendExecNotification(
  deps: ExecNotificationDeps,
  notificationId: string,
): Promise<ResendResult> {
  const [old] = await deps.db
    .select()
    .from(execNotifications)
    .where(eq(execNotifications.id, notificationId))
    .limit(1);
  if (!old) return { ok: false, reason: 'not_found' };

  const [booking] = await deps.db
    .select()
    .from(bookings)
    .where(eq(bookings.id, old.bookingId))
    .limit(1);
  if (!booking) return { ok: false, reason: 'not_found' };

  const ctx = await buildExecContextForBooking(deps.db, booking, old.kind);
  if (!ctx) return { ok: false, reason: 'no_driver' };

  const values = await sendOnActiveChannel(deps, ctx);
  const row = await persistAttempt(deps.db, values, old.id);
  if (!row) return { ok: false, reason: 'persist_failed' };
  return { ok: true, notification: row };
}

/**
 * Apply a delivery outcome from the provider webhook to the matching attempt
 * (by provider message id) and refresh the cached booking status. Ignores
 * unknown ids and superseded rows (a resend already replaced them). Returns true
 * if a row was updated. Idempotent: re-applying the same status is a no-op write.
 */
export async function recordDeliveryStatus(
  db: Database,
  providerMessageId: string,
  status: 'delivered' | 'bounced' | 'complained',
): Promise<boolean> {
  const updated = await db
    .update(execNotifications)
    .set({ status, updatedAt: sql`now()` })
    .where(
      and(
        eq(execNotifications.providerMessageId, providerMessageId),
        ne(execNotifications.status, 'superseded'),
      ),
    )
    .returning();
  const row = updated[0];
  if (!row) return false;
  const cached = await computeRollup(db, row.bookingId);
  await db
    .update(bookings)
    .set({ execNotificationStatus: cached })
    .where(eq(bookings.id, row.bookingId));
  return true;
}

/** Full timeline of exec messages for one booking, newest first. */
export async function listExecNotifications(
  db: Database,
  bookingId: string,
): Promise<ExecNotification[]> {
  return db
    .select()
    .from(execNotifications)
    .where(eq(execNotifications.bookingId, bookingId))
    .orderBy(desc(execNotifications.createdAt));
}

// ─── Operator-triggered exec emails ─────────────────────────────────────────
//
// The confirmation and driver-details emails are no longer sent automatically
// on assign / in-progress: the operator drafts, edits and sends them from the
// booking's Exec emails section. `execEmailDraft` pre-fills the form,
// `sendManualExecEmail` sends the edited version (re-branded via
// renderCustomExecEmail) and records it like any other exec notification.

export type ManualEmailKind = 'assigned' | 'en_route';

/** Headline rendered above the operator's edited body, per email. */
const EXEC_EMAIL_HEADING: Record<ManualEmailKind, string> = {
  assigned: 'Booking confirmed',
  en_route: 'Your driver details',
};

export interface ExecEmailDraft {
  to: string;
  subject: string;
  body: string;
}

export type ExecEmailDraftResult =
  | { ok: true; draft: ExecEmailDraft; hasDriver: boolean }
  | { ok: false; reason: 'booking_not_found' | 'no_driver' };

/** Default content for the operator's send-email form. */
export async function execEmailDraft(
  db: Database,
  bookingId: string,
  kind: ManualEmailKind,
): Promise<ExecEmailDraftResult> {
  const [booking] = await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
  if (!booking) return { ok: false, reason: 'booking_not_found' };

  const ctx = await buildExecContextForBooking(db, booking, kind);
  if (kind === 'en_route' && !ctx) return { ok: false, reason: 'no_driver' };

  const rendered = ctx ? renderEmail(ctx) : assignedEmail(booking, null, '');
  return {
    ok: true,
    hasDriver: ctx !== null,
    draft: { to: booking.execEmail ?? '', subject: rendered.subject, body: rendered.draft },
  };
}

const manualEmailSchema = z
  .object({
    bookingId: z.string().uuid(),
    kind: z.enum(['assigned', 'en_route']),
    to: z.string().trim().email('Enter a valid email address').max(200),
    subject: z.string().trim().min(1, 'Subject is required').max(200),
    body: z.string().trim().min(1, 'The email body is empty').max(8000),
  })
  .strict();

export type ManualExecEmailResult =
  | { ok: true; notification: ExecNotification }
  | { ok: false; reason: 'validation'; issues: z.ZodIssue[] }
  | { ok: false; reason: 'booking_not_found' | 'no_driver' | 'not_sendable' | 'persist_failed' };

/**
 * Send an operator-edited exec email and record the attempt. Always email —
 * the manual flow has no SMS arm. The edited draft is wrapped in the branded
 * shell so header/signature/notice never depend on the operator's text.
 */
export async function sendManualExecEmail(
  deps: { db: Database; email?: EmailPort | undefined },
  raw: unknown,
  operatorId: string,
): Promise<ManualExecEmailResult> {
  const parsed = manualEmailSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: 'validation', issues: parsed.error.issues };
  const { bookingId, kind, to, subject, body } = parsed.data;

  const [booking] = await deps.db
    .select()
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);
  if (!booking) return { ok: false, reason: 'booking_not_found' };
  if (booking.state === 'cancelled') return { ok: false, reason: 'not_sendable' };
  if (kind === 'en_route' && !booking.assignedDriverId && !booking.isBackfill) {
    return { ok: false, reason: 'no_driver' };
  }

  const rendered = renderCustomExecEmail(subject, body, EXEC_EMAIL_HEADING[kind]);
  const base = { bookingId: booking.id, channel: 'email' as const, kind };
  const values: NewExecNotification = deps.email
    ? {
        ...base,
        to,
        subject,
        body: rendered.text,
        ...(await performEmailSend(deps.email, to, subject, rendered.text, rendered.html)),
      }
    : {
        ...base,
        to,
        subject,
        body: rendered.text,
        status: 'failed',
        providerMessageId: null,
        errorReason: 'email_not_configured',
      };

  const row = await persistAttempt(deps.db, values);
  if (!row) return { ok: false, reason: 'persist_failed' };

  await recordAuditEvent(deps.db, {
    actorType: 'operator',
    actorId: operatorId,
    entityType: 'booking',
    entityId: booking.id,
    action: 'send_exec_email',
    before: null,
    after: { kind, to, status: row.status },
  });

  return { ok: true, notification: row };
}

export interface ExecEmailSends {
  /** Latest successful confirmation email (kind `assigned`), or null. */
  confirmationSentAt: Date | null;
  /** Latest successful driver-details email (kind `en_route`), or null. */
  driverDetailsSentAt: Date | null;
}

/**
 * Which of the two operator emails each booking has had — drives the board's
 * "email not sent yet" flags. Only sent/delivered rows count; a failed or
 * bounced attempt still needs the operator's attention.
 */
export async function execEmailSendMap(
  db: Database,
  bookingIds: string[],
): Promise<Map<string, ExecEmailSends>> {
  const map = new Map<string, ExecEmailSends>();
  if (bookingIds.length === 0) return map;
  const rows = await db
    .select({
      bookingId: execNotifications.bookingId,
      kind: execNotifications.kind,
      createdAt: execNotifications.createdAt,
    })
    .from(execNotifications)
    .where(
      and(
        inArray(execNotifications.bookingId, bookingIds),
        inArray(execNotifications.kind, ['assigned', 'en_route']),
        inArray(execNotifications.status, ['sent', 'delivered']),
      ),
    );
  for (const r of rows) {
    const entry = map.get(r.bookingId) ?? { confirmationSentAt: null, driverDetailsSentAt: null };
    if (r.kind === 'assigned') {
      if (!entry.confirmationSentAt || r.createdAt > entry.confirmationSentAt)
        entry.confirmationSentAt = r.createdAt;
    } else if (r.kind === 'en_route') {
      if (!entry.driverDetailsSentAt || r.createdAt > entry.driverDetailsSentAt)
        entry.driverDetailsSentAt = r.createdAt;
    }
    map.set(r.bookingId, entry);
  }
  return map;
}

/** States where the two operator emails are expected to have gone out. */
const EMAIL_EXPECTED_STATES = [
  'assigned',
  'in_progress',
  'awaiting_driver_form',
  'awaiting_operator_review',
] as const;

/**
 * Bookings whose exec emails need operator attention — the "Emails due" rail
 * view. Two ways in:
 *  - a driver (or backfill) is on the job but the confirmation and/or
 *    driver-details email hasn't been successfully sent yet;
 *  - the last exec message failed/bounced (any non-cancelled state).
 * Cancelled bookings never appear: nothing should be emailed for them.
 */
export async function listEmailAttentionBookings(
  db: Database,
): Promise<(typeof bookings.$inferSelect)[]> {
  const candidates = await db
    .select()
    .from(bookings)
    .where(
      or(
        and(
          inArray(bookings.state, [...EMAIL_EXPECTED_STATES]),
          or(isNotNull(bookings.assignedDriverId), eq(bookings.isBackfill, true)),
        ),
        and(ne(bookings.state, 'cancelled'), eq(bookings.execNotificationStatus, 'failed')),
      ),
    )
    .orderBy(asc(bookings.pickupAt))
    .limit(200);

  const sends = await execEmailSendMap(
    db,
    candidates.map((b) => b.id),
  );
  return candidates.filter((b) => {
    if (b.execNotificationStatus === 'failed') return true;
    const s = sends.get(b.id);
    return !s?.confirmationSentAt || !s?.driverDetailsSentAt;
  });
}
