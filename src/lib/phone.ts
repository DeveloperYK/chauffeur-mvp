import { type CountryCode, parsePhoneNumberFromString } from 'libphonenumber-js';
import { z } from 'zod';

/**
 * Default region for bare national numbers. This is a UK chauffeur operation, so
 * a number typed the way an operator reads it off a card — `07911 123456` or
 * `020 7946 0000` — is interpreted as British and normalised to +44. Numbers
 * written in full international form (`+33 6 …`) still parse to their own country.
 */
const DEFAULT_COUNTRY: CountryCode = 'GB';

/** Human-facing guidance shown on the field and used as the invalid-format message. */
export const PHONE_HINT =
  'UK number starting 0 (e.g. 07911 123456) or an international number with its country code (e.g. +33 6 12 34 56 78).';

/**
 * Parse an operator-entered phone number to canonical E.164 (`+447911123456`),
 * assuming {@link DEFAULT_COUNTRY} for numbers without an explicit country code.
 * Returns null when the input is not a valid, dialable number.
 */
export function normalizePhone(input: string): string | null {
  const parsed = parsePhoneNumberFromString(input.trim(), DEFAULT_COUNTRY);
  return parsed?.isValid() ? parsed.format('E.164') : null;
}

/**
 * Zod schema for a required phone field. Accepts UK `0`-prefixed numbers as well
 * as full international `+` numbers, and stores the canonical E.164 form. Invalid
 * input fails with {@link PHONE_HINT} so the operator sees exactly what to type.
 */
export const phoneSchema = z
  .string()
  .trim()
  .min(1, 'Phone number is required')
  .max(30, PHONE_HINT)
  .transform((value, ctx) => {
    const e164 = normalizePhone(value);
    if (!e164) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: PHONE_HINT });
      return z.NEVER;
    }
    return e164;
  });

/**
 * Zod schema for an optional phone field: blank/absent parses to null,
 * anything else must be a valid number and is stored in E.164 form.
 */
export const optionalPhoneSchema = z
  .string()
  .trim()
  .max(30, PHONE_HINT)
  .optional()
  .nullable()
  .transform((value, ctx) => {
    if (!value) return null;
    const e164 = normalizePhone(value);
    if (!e164) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: PHONE_HINT });
      return z.NEVER;
    }
    return e164;
  });
