import { signDriverLink, verifyDriverLink } from '@/server/domain/link-tokens';
import { describe, expect, it } from 'vitest';

const SECRET = 'test-secret-must-be-at-least-32-characters-long-yes';
const OTHER_SECRET = 'completely-different-32-byte-min-secret-for-tests!!';
const NOW = new Date('2026-05-18T12:00:00.000Z');
const EXP = new Date('2026-05-19T12:00:00.000Z');

const JOB_ID = '11111111-1111-1111-1111-111111111111';
const DRIVER_ID = '22222222-2222-2222-2222-222222222222';
const JTI = 'jti-abc-12345';

describe('driver link tokens', () => {
  it('signs and verifies a dispatch link', async () => {
    const token = await signDriverLink(SECRET, {
      jobId: JOB_ID,
      driverId: DRIVER_ID,
      type: 'dispatch',
      jti: JTI,
      now: NOW,
      expiresAt: EXP,
    });
    const result = await verifyDriverLink(SECRET, token, NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.jobId).toBe(JOB_ID);
      expect(result.payload.driverId).toBe(DRIVER_ID);
      expect(result.payload.type).toBe('dispatch');
      expect(result.payload.jti).toBe(JTI);
    }
  });

  it('signs and verifies a completion link', async () => {
    const token = await signDriverLink(SECRET, {
      jobId: JOB_ID,
      driverId: DRIVER_ID,
      type: 'completion',
      jti: JTI,
      now: NOW,
      expiresAt: EXP,
    });
    const result = await verifyDriverLink(SECRET, token, NOW);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload.type).toBe('completion');
  });

  it('rejects when verified against a different secret', async () => {
    const token = await signDriverLink(SECRET, {
      jobId: JOB_ID,
      driverId: DRIVER_ID,
      type: 'dispatch',
      jti: JTI,
      now: NOW,
      expiresAt: EXP,
    });
    const result = await verifyDriverLink(OTHER_SECRET, token, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid_signature');
  });

  it('rejects an expired token', async () => {
    const token = await signDriverLink(SECRET, {
      jobId: JOB_ID,
      driverId: DRIVER_ID,
      type: 'dispatch',
      jti: JTI,
      now: NOW,
      expiresAt: EXP,
    });
    const wayLater = new Date(EXP.getTime() + 60_000);
    const result = await verifyDriverLink(SECRET, token, wayLater);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('expired');
  });

  it('rejects a tampered token', async () => {
    const token = await signDriverLink(SECRET, {
      jobId: JOB_ID,
      driverId: DRIVER_ID,
      type: 'dispatch',
      jti: JTI,
      now: NOW,
      expiresAt: EXP,
    });
    // Flip a character in the signature part
    const parts = token.split('.');
    const sig = parts[2] ?? '';
    const tampered = `${parts[0]}.${parts[1]}.${sig.slice(0, -2)}aa`;
    const result = await verifyDriverLink(SECRET, tampered, NOW);
    expect(result.ok).toBe(false);
  });

  it('rejects an obviously malformed token', async () => {
    const result = await verifyDriverLink(SECRET, 'not-a-jwt', NOW);
    expect(result.ok).toBe(false);
  });

  it('rejects signing with a too-short secret', async () => {
    await expect(
      signDriverLink('short', {
        jobId: JOB_ID,
        driverId: DRIVER_ID,
        type: 'dispatch',
        jti: JTI,
        now: NOW,
        expiresAt: EXP,
      }),
    ).rejects.toThrow(/at least 32/);
  });

  it('rejects signing when exp <= iat', async () => {
    await expect(
      signDriverLink(SECRET, {
        jobId: JOB_ID,
        driverId: DRIVER_ID,
        type: 'dispatch',
        jti: JTI,
        now: NOW,
        expiresAt: NOW,
      }),
    ).rejects.toThrow(/expiresAt/);
  });

  it('rejects a token signed for a different audience', async () => {
    // Build a token with the same secret/alg but a different aud via a low-level path:
    // we use SignJWT directly to forge an audience mismatch.
    const { SignJWT } = await import('jose');
    const key = new TextEncoder().encode(SECRET);
    const forged = await new SignJWT({
      jobId: JOB_ID,
      driverId: DRIVER_ID,
      type: 'dispatch',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('chauffeur-dispatch')
      .setAudience('something-else')
      .setJti(JTI)
      .setIssuedAt(Math.floor(NOW.getTime() / 1000))
      .setExpirationTime(Math.floor(EXP.getTime() / 1000))
      .sign(key);

    const result = await verifyDriverLink(SECRET, forged, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('wrong_audience');
  });
});
