import { createHmac } from 'node:crypto';
import { verifySvixSignature } from '@/server/domain/svix-signature';
import { describe, expect, it } from 'vitest';

const SECRET = `whsec_${Buffer.from('test-signing-key-bytes').toString('base64')}`;
const NOW = new Date('2026-06-20T12:00:00.000Z');
const TS = String(Math.floor(NOW.getTime() / 1000));
const ID = 'msg_123';
const BODY = '{"type":"email.delivered","data":{"email_id":"re_abc"}}';

/** Produce a valid `v1,<sig>` header for the given parts. */
function sign(secret: string, id: string, ts: string, body: string): string {
  const key = Buffer.from(secret.replace('whsec_', ''), 'base64');
  const sig = createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64');
  return `v1,${sig}`;
}

const base = {
  secret: SECRET,
  svixId: ID,
  svixTimestamp: TS,
  body: BODY,
  now: NOW,
};

describe('domain/svix-signature verifySvixSignature', () => {
  it('accepts a correctly signed payload', () => {
    expect(verifySvixSignature({ ...base, signatureHeader: sign(SECRET, ID, TS, BODY) })).toBe(
      true,
    );
  });

  it('accepts when one of several space-separated signatures matches', () => {
    const header = `v1,AAAA ${sign(SECRET, ID, TS, BODY)}`;
    expect(verifySvixSignature({ ...base, signatureHeader: header })).toBe(true);
  });

  it('rejects a tampered body', () => {
    const header = sign(SECRET, ID, TS, BODY);
    expect(verifySvixSignature({ ...base, body: `${BODY} `, signatureHeader: header })).toBe(false);
  });

  it('rejects a signature made with the wrong secret', () => {
    const header = sign(`whsec_${Buffer.from('other-key').toString('base64')}`, ID, TS, BODY);
    expect(verifySvixSignature({ ...base, signatureHeader: header })).toBe(false);
  });

  it('rejects a stale timestamp (replay outside the window)', () => {
    const staleTs = String(Math.floor(NOW.getTime() / 1000) - 10 * 60);
    expect(
      verifySvixSignature({
        ...base,
        svixTimestamp: staleTs,
        signatureHeader: sign(SECRET, ID, staleTs, BODY),
      }),
    ).toBe(false);
  });

  it('rejects a future timestamp outside the window', () => {
    const futureTs = String(Math.floor(NOW.getTime() / 1000) + 10 * 60);
    expect(
      verifySvixSignature({
        ...base,
        svixTimestamp: futureTs,
        signatureHeader: sign(SECRET, ID, futureTs, BODY),
      }),
    ).toBe(false);
  });

  it('rejects missing headers', () => {
    expect(verifySvixSignature({ ...base, signatureHeader: null })).toBe(false);
    expect(verifySvixSignature({ ...base, svixId: null, signatureHeader: 'v1,x' })).toBe(false);
    expect(verifySvixSignature({ ...base, svixTimestamp: null, signatureHeader: 'v1,x' })).toBe(
      false,
    );
  });

  it('rejects a non-v1 signature scheme', () => {
    const sig = sign(SECRET, ID, TS, BODY).slice('v1,'.length);
    expect(verifySvixSignature({ ...base, signatureHeader: `v2,${sig}` })).toBe(false);
  });

  it('rejects an empty secret', () => {
    expect(
      verifySvixSignature({ ...base, secret: '', signatureHeader: sign(SECRET, ID, TS, BODY) }),
    ).toBe(false);
  });
});
