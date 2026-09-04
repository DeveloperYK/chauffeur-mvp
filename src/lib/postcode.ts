/**
 * UK postcode helpers — pure, client-safe (no I/O).
 *
 * Drivers navigate by postcode, so every booking address must carry one. The
 * postcode lives inside the free-text address (no separate column); these
 * helpers find it, validate an operator-typed one, and append it.
 */

/**
 * UK postcode: outward code (area letters + district, e.g. `SW1A`, `EC1A`,
 * `N1C`, `DN55`) then inward code (digit + two letters). Word boundaries stop a
 * flight number or house number from matching. `i` because operators type in
 * either case.
 */
const POSTCODE_RE = /\b([A-Z]{1,2}\d{1,2}[A-Z]?)\s*(\d[A-Z]{2})\b/i;
const WHOLE_POSTCODE_RE = /^([A-Z]{1,2}\d{1,2}[A-Z]?)\s*(\d[A-Z]{2})$/i;

const format = (outward: string, inward: string): string =>
  `${outward.toUpperCase()} ${inward.toUpperCase()}`;

/** The first UK postcode found in `text`, normalised ("N1C 4QP"), or `null`. */
export function extractPostcode(text: string): string | null {
  const m = POSTCODE_RE.exec(text);
  return m?.[1] && m[2] ? format(m[1], m[2]) : null;
}

/** Whether `text` contains a UK postcode anywhere. */
export function hasPostcode(text: string): boolean {
  return extractPostcode(text) !== null;
}

/** Whether `value` is exactly one UK postcode (surrounding whitespace allowed). */
export function isValidUkPostcode(value: string): boolean {
  return WHOLE_POSTCODE_RE.test(value.trim());
}

/** Trailing country suffixes Google appends to every GB prediction — pure noise here. */
const COUNTRY_SUFFIX = /,\s*(uk|united kingdom)\s*$/i;

const squash = (value: string): string => value.replace(/\s+/g, '').toUpperCase();

/**
 * Append `postcode` to an address unless it is already present (any case or
 * spacing). The country suffix is dropped in favour of the postcode. With no
 * postcode the address is returned untouched.
 */
export function withPostcode(address: string, postcode: string | null | undefined): string {
  const raw = postcode?.trim() ?? '';
  if (raw.length === 0) return address;
  if (squash(address).includes(squash(raw))) return address;
  const m = WHOLE_POSTCODE_RE.exec(raw);
  const pc = m?.[1] && m[2] ? format(m[1], m[2]) : raw.toUpperCase();
  return `${address.replace(COUNTRY_SUFFIX, '')}, ${pc}`;
}

export const PICKUP_POSTCODE_MESSAGE = 'Pickup address needs a postcode';
export const DROPOFF_POSTCODE_MESSAGE = 'Destination needs a postcode';

interface AddressFields {
  serviceType: string;
  pickupAddress: string;
  dropoffAddress: string | null | undefined;
}

/**
 * Field errors for booking addresses missing a postcode, keyed by field name to
 * match the form's `fieldErrors` shape. Empty addresses are left to the
 * required-field rule; an hourly hire has no destination to check.
 */
export function addressPostcodeErrors(fields: AddressFields): Record<string, string> {
  const pickup = fields.pickupAddress.trim();
  const dropoff = fields.dropoffAddress?.trim() ?? '';
  const checkDropoff = fields.serviceType === 'transfer' && dropoff.length > 0;
  return {
    ...(pickup.length > 0 && !hasPostcode(pickup)
      ? { pickupAddress: PICKUP_POSTCODE_MESSAGE }
      : {}),
    ...(checkDropoff && !hasPostcode(dropoff) ? { dropoffAddress: DROPOFF_POSTCODE_MESSAGE } : {}),
  };
}
