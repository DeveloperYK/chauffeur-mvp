import { FakeEmailAdapter } from '@/server/adapters/email-fake';
import { describe, expect, it } from 'vitest';
import { emailContractTests } from './email.contract';

emailContractTests(() => new FakeEmailAdapter());

describe('FakeEmailAdapter specifics', () => {
  it('records sent emails, simulates failure, and resets', async () => {
    const adapter = new FakeEmailAdapter();
    await adapter.sendEmail({ to: 'e@x.com', subject: 's', text: 't' });
    expect(adapter.sent.length).toBe(1);

    adapter.simulateFailure('http_500');
    const failed = await adapter.sendEmail({ to: 'e@x.com', subject: 's', text: 't' });
    expect(failed).toEqual({ ok: false, reason: 'http_500' });

    adapter.simulateFailure(null);
    adapter.reset();
    expect(adapter.sent.length).toBe(0);
  });
});
