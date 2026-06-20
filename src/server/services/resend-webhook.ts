import { logger } from '@/lib/logger';
import type { Database } from '@/server/db';
import { verifySvixSignature } from '@/server/domain/svix-signature';
import { recordDeliveryStatus } from './exec-notifications';

/**
 * Resend delivery webhook handler. Verifies the Svix signature, then maps the
 * event to a delivery status and applies it to the matching exec notification
 * (by provider message id). Decoupled from the route so it can be tested with a
 * real DB + crafted signed body.
 *
 * Events we act on: `email.delivered` → delivered, `email.bounced` → bounced,
 * `email.complained` → complained. Everything else (sent, delivery_delayed,
 * opened, clicked, …) is acknowledged with 200 and ignored. Unknown email ids
 * are also acked — webhooks must get a 2xx or the provider keeps retrying.
 */
export interface ResendWebhookDeps {
  db: Database;
  secret: string;
  now: Date;
  toleranceMs?: number;
}

export interface ResendWebhookHeaders {
  svixId: string | null;
  svixTimestamp: string | null;
  svixSignature: string | null;
}

const EVENT_TO_STATUS: Record<string, 'delivered' | 'bounced' | 'complained' | undefined> = {
  'email.delivered': 'delivered',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
};

export async function handleResendWebhook(
  deps: ResendWebhookDeps,
  headers: ResendWebhookHeaders,
  rawBody: string,
): Promise<{ status: number; body: string }> {
  if (!deps.secret) return { status: 503, body: 'webhook disabled' };

  const verified = verifySvixSignature({
    secret: deps.secret,
    svixId: headers.svixId,
    svixTimestamp: headers.svixTimestamp,
    signatureHeader: headers.svixSignature,
    body: rawBody,
    now: deps.now,
    toleranceMs: deps.toleranceMs,
  });
  if (!verified) return { status: 401, body: 'invalid signature' };

  let event: { type?: string; data?: { email_id?: string } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: 'invalid json' };
  }

  const status = event.type ? EVENT_TO_STATUS[event.type] : undefined;
  const emailId = event.data?.email_id;
  if (!status || !emailId) {
    // Acknowledged but no state change (interim/irrelevant event or missing id).
    return { status: 200, body: 'ignored' };
  }

  try {
    await recordDeliveryStatus(deps.db, emailId, status);
  } catch (err) {
    logger.error({ err, emailId }, 'failed to apply resend delivery status');
    // Still 200 so Resend doesn't hammer retries on a transient DB blip; the
    // next event (or a resend) will reconcile.
    return { status: 200, body: 'logged' };
  }
  return { status: 200, body: 'ok' };
}
