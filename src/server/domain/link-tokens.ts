import { type JWTPayload, SignJWT, jwtVerify } from 'jose';
import { z } from 'zod';

export type DriverLinkType = 'dispatch' | 'completion' | 'change_confirm';

export interface DriverLinkPayload {
  jobId: string;
  driverId: string;
  type: DriverLinkType;
  jti: string;
  iat: number;
  exp: number;
}

const payloadSchema = z.object({
  jobId: z.string().uuid(),
  driverId: z.string().uuid(),
  type: z.enum(['dispatch', 'completion', 'change_confirm']),
  jti: z.string().min(8),
  iat: z.number().int(),
  exp: z.number().int(),
});

const ISSUER = 'chauffeur-dispatch';
const AUDIENCE = 'driver-link';
const ALG = 'HS256';

function toKey(secret: string): Uint8Array {
  if (secret.length < 32) {
    throw new Error('DRIVER_LINK_SECRET must be at least 32 characters');
  }
  return new TextEncoder().encode(secret);
}

export interface SignInput {
  jobId: string;
  driverId: string;
  type: DriverLinkType;
  jti: string;
  expiresAt: Date;
  now: Date;
}

export async function signDriverLink(secret: string, input: SignInput): Promise<string> {
  const iat = Math.floor(input.now.getTime() / 1000);
  const exp = Math.floor(input.expiresAt.getTime() / 1000);
  if (exp <= iat) {
    throw new Error('expiresAt must be in the future');
  }
  const jwt = new SignJWT({
    jobId: input.jobId,
    driverId: input.driverId,
    type: input.type,
  } satisfies JWTPayload)
    .setProtectedHeader({ alg: ALG })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setJti(input.jti)
    .setIssuedAt(iat)
    .setExpirationTime(exp);
  return jwt.sign(toKey(secret));
}

export type VerifyResult =
  | { ok: true; payload: DriverLinkPayload }
  | { ok: false; reason: VerifyError };

export type VerifyError = 'invalid_signature' | 'expired' | 'malformed' | 'wrong_audience';

export async function verifyDriverLink(
  secret: string,
  token: string,
  now: Date = new Date(),
): Promise<VerifyResult> {
  try {
    const { payload } = await jwtVerify(token, toKey(secret), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: [ALG],
      currentDate: now,
    });
    const parsed = payloadSchema.safeParse(payload);
    if (!parsed.success) return { ok: false, reason: 'malformed' };
    return { ok: true, payload: parsed.data };
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'ERR_JWT_EXPIRED') return { ok: false, reason: 'expired' };
    if (code === 'ERR_JWT_CLAIM_VALIDATION_FAILED') return { ok: false, reason: 'wrong_audience' };
    if (code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED') {
      return { ok: false, reason: 'invalid_signature' };
    }
    return { ok: false, reason: 'malformed' };
  }
}
