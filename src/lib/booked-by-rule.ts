/**
 * "Booked by (PA)" rule — pure, client-safe (no I/O).
 *
 * Every booking must carry the PA's name and email: the booking confirmation
 * and update emails are addressed to the PA (ADR 0028), so a booking without
 * one has nowhere to send them. The phone stays optional.
 *
 * Enforced at the operator-form boundary (create + edit server actions), like
 * the postcode rule, so simulator seeds and bookings saved before the rule are
 * unaffected until an operator next edits them (ADR 0031).
 */

export const BOOKED_BY_NAME_MESSAGE = "Add the PA's name";
export const BOOKED_BY_EMAIL_MESSAGE = "Add the PA's email — the confirmation is sent to it";

interface BookedByFields {
  bookedByName?: string | null | undefined;
  bookedByEmail?: string | null | undefined;
  bookedByPhone?: string | null | undefined;
}

/** Keyed by form field name, so it drops straight into a form's `fieldErrors`. */
export type BookedByErrors = Partial<Record<'bookedByName' | 'bookedByEmail', string>>;

/** Per-field messages for the missing mandatory PA fields; empty when complete. */
export function bookedByErrors(fields: BookedByFields): BookedByErrors {
  const name = (fields.bookedByName ?? '').trim();
  const email = (fields.bookedByEmail ?? '').trim();
  return {
    ...(name ? {} : { bookedByName: BOOKED_BY_NAME_MESSAGE }),
    ...(email ? {} : { bookedByEmail: BOOKED_BY_EMAIL_MESSAGE }),
  };
}
