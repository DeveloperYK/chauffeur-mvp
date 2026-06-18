import { rollupExecStatus } from '@/server/domain/exec-notifications';
import { describe, expect, it } from 'vitest';

describe('domain/exec-notifications rollupExecStatus', () => {
  it('returns none when nothing has been sent', () => {
    expect(rollupExecStatus([])).toBe('none');
  });

  it('returns ok when the only SMS message was accepted (sent)', () => {
    expect(rollupExecStatus([{ channel: 'sms', status: 'sent' }])).toBe('ok');
  });

  it('returns ok when an email was delivered', () => {
    expect(rollupExecStatus([{ channel: 'email', status: 'delivered' }])).toBe('ok');
  });

  it('treats an accepted-but-unconfirmed email as pending', () => {
    expect(rollupExecStatus([{ channel: 'email', status: 'sent' }])).toBe('pending');
  });

  it('returns failed when an SMS failed', () => {
    expect(rollupExecStatus([{ channel: 'sms', status: 'failed' }])).toBe('failed');
  });

  it('treats a bounced email as failed', () => {
    expect(rollupExecStatus([{ channel: 'email', status: 'bounced' }])).toBe('failed');
  });

  it('treats a complaint as failed', () => {
    expect(rollupExecStatus([{ channel: 'email', status: 'complained' }])).toBe('failed');
  });

  it('is failure-first: one failed kind outweighs another delivered kind', () => {
    expect(
      rollupExecStatus([
        { channel: 'sms', status: 'sent' },
        { channel: 'email', status: 'bounced' },
      ]),
    ).toBe('failed');
  });

  it('is pending-over-ok when no failures but an email is still in flight', () => {
    expect(
      rollupExecStatus([
        { channel: 'sms', status: 'sent' },
        { channel: 'email', status: 'sent' },
      ]),
    ).toBe('pending');
  });

  it('returns ok when every kind is healthy', () => {
    expect(
      rollupExecStatus([
        { channel: 'sms', status: 'sent' },
        { channel: 'email', status: 'delivered' },
      ]),
    ).toBe('ok');
  });
});
