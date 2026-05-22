import { logger } from '@/lib/logger';
import type { NotificationPort, SmsMessage } from '@/server/ports/notifications';

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string; // E.164
  fetchImpl?: typeof fetch; // overrideable for tests
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * A valid Twilio sender is either an E.164 number (`+` followed by 7–15 digits)
 * or an Alphanumeric Sender ID — 1–11 characters of letters/digits/spaces
 * containing at least one letter. Alphanumeric IDs are one-way and the right
 * choice for UK notification traffic (e.g. "Chauffeur"); see
 * docs/adr/0005-twilio-alphanumeric-sender.md.
 */
export function isValidTwilioSender(from: string): boolean {
  if (/^\+[1-9]\d{6,14}$/.test(from)) return true;
  return /^(?=.*[A-Za-z])[A-Za-z0-9 ]{1,11}$/.test(from);
}

export class TwilioNotificationAdapter implements NotificationPort {
  private readonly url: string;
  private readonly authHeader: string;

  constructor(private readonly cfg: TwilioConfig) {
    if (!cfg.accountSid || !cfg.authToken || !cfg.fromNumber) {
      throw new Error('TwilioNotificationAdapter requires SID, token, and from-number');
    }
    if (!isValidTwilioSender(cfg.fromNumber)) {
      throw new Error(
        'TwilioNotificationAdapter from-number must be E.164 (start with +) or an alphanumeric Sender ID (1–11 chars, at least one letter)',
      );
    }
    this.url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(cfg.accountSid)}/Messages.json`;
    this.authHeader = `Basic ${Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString('base64')}`;
  }

  async sendSms(
    msg: SmsMessage,
  ): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
    if (!msg.to.startsWith('+')) return { ok: false, reason: 'invalid_to' };
    if (!msg.body) return { ok: false, reason: 'empty_body' };
    if (msg.body.length > 1600) return { ok: false, reason: 'body_too_long' };

    const body = new URLSearchParams({
      To: msg.to,
      From: this.cfg.fromNumber,
      Body: msg.body,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const doFetch = this.cfg.fetchImpl ?? fetch;
    try {
      const res = await doFetch(this.url, {
        method: 'POST',
        headers: {
          Authorization: this.authHeader,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: body.toString(),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        logger.warn(
          { status: res.status, twilioError: text.slice(0, 500) },
          'twilio non-2xx response',
        );
        return { ok: false, reason: `http_${res.status}` };
      }
      const json = (await res.json()) as { sid?: string; status?: string };
      if (!json.sid) return { ok: false, reason: 'no_sid_in_response' };
      return { ok: true, id: json.sid };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return { ok: false, reason: 'timeout' };
      }
      logger.error({ err }, 'twilio request failed');
      return { ok: false, reason: 'network_error' };
    } finally {
      clearTimeout(timeout);
    }
  }
}
