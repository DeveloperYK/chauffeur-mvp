import { ResendEmailAdapter } from '@/server/adapters/email-resend';
import { describe, expect, it } from 'vitest';
import { emailContractTests } from './email.contract';

/** A fetch stub that returns a Resend-style success for any request. */
function okFetch(): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ id: 're_test_123' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
}

emailContractTests(
  () =>
    new ResendEmailAdapter({ apiKey: 'test', from: 'onboarding@resend.dev', fetchImpl: okFetch() }),
);

describe('ResendEmailAdapter mapping', () => {
  const base = { apiKey: 'test', from: 'onboarding@resend.dev' };
  const valid = { to: 'exec@example.com', subject: 's', text: 't' };

  it('returns the Resend message id on success', async () => {
    const a = new ResendEmailAdapter({ ...base, fetchImpl: okFetch() });
    const r = await a.sendEmail(valid);
    expect(r).toEqual({ ok: true, id: 're_test_123' });
  });

  it('maps a non-2xx response to http_<status>', async () => {
    const fetchImpl = (async () => new Response('bad', { status: 422 })) as unknown as typeof fetch;
    const a = new ResendEmailAdapter({ ...base, fetchImpl });
    expect(await a.sendEmail(valid)).toEqual({ ok: false, reason: 'http_422' });
  });

  it('maps an abort to timeout', async () => {
    const fetchImpl = (async () => {
      const e = new Error('aborted');
      e.name = 'AbortError';
      throw e;
    }) as unknown as typeof fetch;
    const a = new ResendEmailAdapter({ ...base, fetchImpl });
    expect(await a.sendEmail(valid)).toEqual({ ok: false, reason: 'timeout' });
  });

  it('maps a network error to network_error', async () => {
    const fetchImpl = (async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof fetch;
    const a = new ResendEmailAdapter({ ...base, fetchImpl });
    expect(await a.sendEmail(valid)).toEqual({ ok: false, reason: 'network_error' });
  });

  it('flags a 2xx without an id', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch;
    const a = new ResendEmailAdapter({ ...base, fetchImpl });
    expect(await a.sendEmail(valid)).toEqual({ ok: false, reason: 'no_id_in_response' });
  });

  it('requires apiKey and from', () => {
    expect(() => new ResendEmailAdapter({ apiKey: '', from: '' })).toThrow();
  });
});
