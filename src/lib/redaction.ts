/**
 * Single source of truth for sensitive field handling.
 *
 * Two consumers share this list so they can never drift apart:
 *  - the Pino logger (path-based redaction) — see `logger.ts`
 *  - the Sentry event scrubber (substring key matching) — see
 *    `observability/scrub.ts`
 *
 * CLAUDE.md §6 forbids logging passwords, tokens, phone numbers, session
 * cookies, and exec PII. This module encodes that rule once.
 */

/** Replacement value written in place of any sensitive data. */
export const REDACTED = '[redacted]';

/**
 * Concrete field names redacted by the Pino logger. Path-based: Pino needs an
 * explicit list, so we expand each name to both the top-level key and a
 * one-level-deep wildcard (`phone` and `*.phone`).
 */
export const PII_FIELD_NAMES = [
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'phone',
  'whatsappNumber',
  'mobile',
] as const;

/** Pino `redact.paths` derived from {@link PII_FIELD_NAMES}. */
export const PINO_REDACT_PATHS: string[] = PII_FIELD_NAMES.flatMap((name) => [name, `*.${name}`]);

/**
 * Substrings that mark an object key as sensitive for the Sentry scrubber.
 * Broader than the Pino list on purpose: Sentry events can carry secrets and
 * exec PII in arbitrarily-named nested keys (e.g. `driverPhone`, `execEmail`,
 * `x-clock-secret`), so we match by substring rather than exact name.
 */
export const SENSITIVE_KEY_SUBSTRINGS = [
  'password',
  'token',
  'secret',
  'authorization',
  'apikey',
  'api_key',
  'phone',
  'mobile',
  'whatsapp',
  'email',
  'jwt',
  'cookie',
] as const;

/** True when `key` looks like it holds sensitive data (case-insensitive). */
export function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEY_SUBSTRINGS.some((needle) => lower.includes(needle));
}
