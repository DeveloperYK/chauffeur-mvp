import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Manual verification of a Svix-signed webhook (Resend uses Svix), so we don't
 * pull in the svix SDK. The signed content is `${id}.${timestamp}.${body}`,
 * HMAC-SHA256'd with the base64-decoded secret (after the `whsec_` prefix),
 * base64-encoded. The `svix-signature` header is a space-separated list of
 * `v1,<base64sig>` entries — any matching entry verifies. Comparison is
 * constant-time and the timestamp must be within the tolerance window to resist
 * replay. See docs/shaping/exec-messages.
 */
export interface VerifySvixInput {
  secret: string;
  svixId: string | null | undefined;
  svixTimestamp: string | null | undefined;
  signatureHeader: string | null | undefined;
  body: string;
  now: Date;
  toleranceMs?: number | undefined;
}

const DEFAULT_TOLERANCE_MS = 5 * 60 * 1000; // 5 minutes

export function verifySvixSignature(input: VerifySvixInput): boolean {
  const { secret, svixId, svixTimestamp, signatureHeader, body, now } = input;
  if (!secret || !svixId || !svixTimestamp || !signatureHeader) return false;

  // Replay window: the timestamp (epoch seconds) must be recent.
  const tsSeconds = Number(svixTimestamp);
  if (!Number.isFinite(tsSeconds)) return false;
  const toleranceMs = input.toleranceMs ?? DEFAULT_TOLERANCE_MS;
  if (Math.abs(now.getTime() - tsSeconds * 1000) > toleranceMs) return false;

  // Key is the base64 part after `whsec_`.
  const rawKey = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
  let keyBytes: Buffer;
  try {
    keyBytes = Buffer.from(rawKey, 'base64');
  } catch {
    return false;
  }
  if (keyBytes.length === 0) return false;

  const signedContent = `${svixId}.${svixTimestamp}.${body}`;
  const expected = createHmac('sha256', keyBytes).update(signedContent).digest();

  for (const part of signatureHeader.split(' ')) {
    const comma = part.indexOf(',');
    if (comma < 0) continue;
    const version = part.slice(0, comma);
    const sig = part.slice(comma + 1);
    if (version !== 'v1' || !sig) continue;
    let sigBytes: Buffer;
    try {
      sigBytes = Buffer.from(sig, 'base64');
    } catch {
      continue;
    }
    if (sigBytes.length === expected.length && timingSafeEqual(sigBytes, expected)) {
      return true;
    }
  }
  return false;
}
