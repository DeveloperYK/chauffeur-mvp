import { FakeNotificationAdapter } from '@/server/adapters/notification-fake';
import { describe, expect, it } from 'vitest';

describe('FakeNotificationAdapter', () => {
  it('records sends and returns incrementing ids', async () => {
    const f = new FakeNotificationAdapter();
    const r1 = await f.sendSms({ to: '+447911000001', body: 'hello' });
    const r2 = await f.sendSms({ to: '+447911000002', body: 'world' });
    expect(r1.ok && r1.id).toBe('fake-1');
    expect(r2.ok && r2.id).toBe('fake-2');
    expect(f.sent.length).toBe(2);
  });

  it('rejects non-E.164', async () => {
    const f = new FakeNotificationAdapter();
    const r = await f.sendSms({ to: '07911', body: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid_to');
    expect(f.sent.length).toBe(0);
  });

  it('reset clears history', async () => {
    const f = new FakeNotificationAdapter();
    await f.sendSms({ to: '+447911000001', body: 'hi' });
    f.reset();
    expect(f.sent.length).toBe(0);
    const r = await f.sendSms({ to: '+447911000002', body: 'hi' });
    if (r.ok) expect(r.id).toBe('fake-1');
  });
});
