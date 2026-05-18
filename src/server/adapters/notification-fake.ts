import type { NotificationPort, SmsMessage } from '@/server/ports/notifications';

export class FakeNotificationAdapter implements NotificationPort {
  readonly sent: SmsMessage[] = [];
  private nextId = 1;

  async sendSms(
    msg: SmsMessage,
  ): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
    if (!msg.to.startsWith('+')) {
      return { ok: false, reason: 'invalid_to' };
    }
    const id = `fake-${this.nextId++}`;
    this.sent.push({ ...msg });
    return { ok: true, id };
  }

  reset(): void {
    this.sent.length = 0;
    this.nextId = 1;
  }
}
