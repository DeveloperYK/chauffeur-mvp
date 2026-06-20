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
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { assignedEmail, changeExecEmail, enRouteEmail } from './email-templates';
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

function renderEmail(ctx: ExecMessageContext): { subject: string; text: string } {
  if (ctx.kind === 'assigned') {
    return assignedEmail(ctx.booking, { name: ctx.driverName }, ctx.car ?? '');
  }
  if (ctx.kind === 'changed') {
    return changeExecEmail(ctx.booking);
  }
  return enRouteEmail(ctx.booking, { name: ctx.driverName });
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
): Promise<SendOutcome> {
  try {
    const res = await email.sendEmail({ to, subject, text });
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
    const { subject, text } = renderEmail(ctx);
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
    const outcome = await performEmailSend(deps.email, to, subject, text);
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
  | { ok: false; reason: 'booking_not_found' | 'no_driver' | 'persist_failed' };

/**
 * Operator-triggered: tell the exec their booking changed, restating the current
 * plan over the active channel. Recorded as a `changed` exec notification so the
 * board health roll-up tracks it like any other send. Used from the mid-flight
 * change banner. See docs/shaping/mid-flight-changes.
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

  const ctx = await buildExecContextForBooking(deps.db, booking, 'changed');
  if (!ctx) return { ok: false, reason: 'no_driver' };

  const row = await sendExecNotification(deps, ctx);
  if (!row) return { ok: false, reason: 'persist_failed' };
  return { ok: true, notification: row };
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
    if (driver) {
      return {
        booking,
        kind,
        driverName: driver.name,
        car: carDescription(driver.car, driver.carColour),
      };
    }
  }
  if (booking.isBackfill && booking.backfillDriverName) {
    return {
      booking,
      kind,
      driverName: booking.backfillDriverName,
      car: booking.backfillCar ?? '',
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
