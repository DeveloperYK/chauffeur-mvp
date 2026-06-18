import { logger } from '@/lib/logger';
import type { EmailMessage, EmailPort } from '@/server/ports/email';

export interface ResendConfig {
  apiKey: string;
  from: string; // verified sender, e.g. "Chauffeur <noreply@domain>" or onboarding@resend.dev
  fetchImpl?: typeof fetch; // overrideable for tests
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const RESEND_URL = 'https://api.resend.com/emails';

/**
 * EmailPort backed by Resend's REST API. Uses `fetch` only — no SDK, so no new
 * npm dependency (same approach as TwilioNotificationAdapter). Error reasons are
 * mapped to the same vocabulary the SMS path uses so the wrapper/logs are
 * uniform. Verified-sender + domain setup is an ops concern (RESEND_FROM).
 */
export class ResendEmailAdapter implements EmailPort {
  constructor(private readonly cfg: ResendConfig) {
    if (!cfg.apiKey || !cfg.from) {
      throw new Error('ResendEmailAdapter requires apiKey and from');
    }
  }

  async sendEmail(
    msg: EmailMessage,
  ): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
    if (!msg.to.includes('@')) return { ok: false, reason: 'invalid_to' };
    if (!msg.subject) return { ok: false, reason: 'empty_subject' };
    if (!msg.text) return { ok: false, reason: 'empty_body' };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const doFetch = this.cfg.fetchImpl ?? fetch;
    try {
      const res = await doFetch(RESEND_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.cfg.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.cfg.from,
          to: msg.to,
          subject: msg.subject,
          text: msg.text,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        logger.warn(
          { status: res.status, resendError: text.slice(0, 500) },
          'resend non-2xx response',
        );
        return { ok: false, reason: `http_${res.status}` };
      }
      const json = (await res.json()) as { id?: string };
      if (!json.id) return { ok: false, reason: 'no_id_in_response' };
      return { ok: true, id: json.id };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return { ok: false, reason: 'timeout' };
      }
      logger.error({ err }, 'resend request failed');
      return { ok: false, reason: 'network_error' };
    } finally {
      clearTimeout(timeout);
    }
  }
}
