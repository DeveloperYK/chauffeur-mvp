import { TwilioNotificationAdapter } from '@/server/adapters/notification-twilio';
import { describe, expect, it, vi } from 'vitest';

const VALID_CFG = {
  accountSid: `AC${'x'.repeat(32)}`,
  authToken: 'auth-token-secret-12345',
  fromNumber: '+15555550000',
};

function makeAdapter(opts: { fetchImpl: typeof fetch; timeoutMs?: number }) {
  return new TwilioNotificationAdapter(
    opts.timeoutMs
      ? { ...VALID_CFG, fetchImpl: opts.fetchImpl, timeoutMs: opts.timeoutMs }
      : { ...VALID_CFG, fetchImpl: opts.fetchImpl },
  );
}

describe('TwilioNotificationAdapter', () => {
  it('throws on missing required config', () => {
    expect(() => new TwilioNotificationAdapter({ ...VALID_CFG, accountSid: '' })).toThrow();
    expect(() => new TwilioNotificationAdapter({ ...VALID_CFG, authToken: '' })).toThrow();
    expect(() => new TwilioNotificationAdapter({ ...VALID_CFG, fromNumber: '' })).toThrow();
  });

  it('throws if from-number is not E.164', () => {
    expect(() => new TwilioNotificationAdapter({ ...VALID_CFG, fromNumber: '5555550000' })).toThrow(
      /E.164/,
    );
  });

  it('rejects non-E.164 destination without calling fetch', async () => {
    const fetchImpl = vi.fn();
    const adapter = makeAdapter({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const r = await adapter.sendSms({ to: '07911000001', body: 'hi' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid_to');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects empty body', async () => {
    const fetchImpl = vi.fn();
    const adapter = makeAdapter({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const r = await adapter.sendSms({ to: '+447911000001', body: '' });
    expect(r.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects body over 1600 chars', async () => {
    const fetchImpl = vi.fn();
    const adapter = makeAdapter({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const r = await adapter.sendSms({ to: '+447911000001', body: 'x'.repeat(1601) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('body_too_long');
  });

  it('POSTs form-encoded payload with Basic auth, returns sid on success', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(JSON.stringify({ sid: 'SMxxx', status: 'queued' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    });
    const adapter = makeAdapter({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const r = await adapter.sendSms({ to: '+447911000001', body: 'hello' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.id).toBe('SMxxx');
    expect(capturedUrl).toContain('/Accounts/');
    expect(capturedUrl).toContain('/Messages.json');
    expect(capturedInit?.method).toBe('POST');
    const auth = (capturedInit?.headers as Record<string, string>)?.Authorization ?? '';
    expect(auth.startsWith('Basic ')).toBe(true);
    expect(capturedInit?.body).toContain('To=%2B447911000001');
    expect(capturedInit?.body).toContain('From=%2B15555550000');
    expect(capturedInit?.body).toContain('Body=hello');
  });

  it('returns http_400 on Twilio 400', async () => {
    const fetchImpl = vi.fn(async () => new Response('bad', { status: 400 }));
    const adapter = makeAdapter({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const r = await adapter.sendSms({ to: '+447911000001', body: 'hi' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('http_400');
  });

  it('returns no_sid_in_response if Twilio omits sid', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({}), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const adapter = makeAdapter({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const r = await adapter.sendSms({ to: '+447911000001', body: 'hi' });
    expect(r.ok).toBe(false);
  });

  it('returns timeout on AbortError', async () => {
    const fetchImpl = vi.fn(async () => {
      const e = new Error('aborted');
      e.name = 'AbortError';
      throw e;
    });
    const adapter = makeAdapter({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 10,
    });
    const r = await adapter.sendSms({ to: '+447911000001', body: 'hi' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('timeout');
  });

  it('returns network_error on generic throw', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('boom');
    });
    const adapter = makeAdapter({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const r = await adapter.sendSms({ to: '+447911000001', body: 'hi' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('network_error');
  });
});
