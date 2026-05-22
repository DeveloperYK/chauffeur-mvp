import type { NotificationPort, SmsMessage } from '@/server/ports/notifications';

const MAX_BODY_LENGTH = 1600;

export class FakeNotificationAdapter implements NotificationPort {
  readonly sent: SmsMessage[] = [];
  private nextId = 1;
  private shouldFail: string | null = null;

  async sendSms(
    msg: SmsMessage,
  ): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
    // Simulate configured failure
    if (this.shouldFail) {
      return { ok: false, reason: this.shouldFail };
    }

    // Validate E.164 format
    if (!msg.to.startsWith('+')) {
      return { ok: false, reason: 'invalid_to' };
    }

    // Validate body is not empty
    if (!msg.body) {
      return { ok: false, reason: 'empty_body' };
    }

    // Validate body length
    if (msg.body.length > MAX_BODY_LENGTH) {
      return { ok: false, reason: 'body_too_long' };
    }

    const id = `fake-${this.nextId++}`;
    this.sent.push({ ...msg });
    return { ok: true, id };
  }

  /**
   * Configure the adapter to fail with a specific reason.
   * Use null to disable failure simulation.
   */
  simulateFailure(reason: string | null): void {
    this.shouldFail = reason;
  }

  reset(): void {
    this.sent.length = 0;
    this.nextId = 1;
    this.shouldFail = null;
  }
}
