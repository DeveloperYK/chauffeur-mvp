import type { EmailMessage, EmailPort } from '@/server/ports/email';

/**
 * In-memory EmailPort double for dev/test. Mirrors FakeNotificationAdapter so
 * the same test ergonomics apply to both channels (sent log, simulateFailure,
 * reset). Behaviour is kept in lock-step with ResendEmailAdapter via the shared
 * contract test (tests/contracts/email.contract.ts).
 */
export class FakeEmailAdapter implements EmailPort {
  readonly sent: EmailMessage[] = [];
  private nextId = 1;
  private shouldFail: string | null = null;

  async sendEmail(
    msg: EmailMessage,
  ): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
    if (this.shouldFail) {
      return { ok: false, reason: this.shouldFail };
    }
    if (!msg.to.includes('@')) {
      return { ok: false, reason: 'invalid_to' };
    }
    if (!msg.subject) {
      return { ok: false, reason: 'empty_subject' };
    }
    if (!msg.text) {
      return { ok: false, reason: 'empty_body' };
    }
    const id = `fake-email-${this.nextId++}`;
    this.sent.push({ ...msg });
    return { ok: true, id };
  }

  /** Configure the adapter to fail with a specific reason. null disables it. */
  simulateFailure(reason: string | null): void {
    this.shouldFail = reason;
  }

  reset(): void {
    this.sent.length = 0;
    this.nextId = 1;
    this.shouldFail = null;
  }
}
