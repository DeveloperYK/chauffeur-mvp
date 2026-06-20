/**
 * Mid-flight change classification.
 *
 * After a booking is dispatched, an operator can still edit it. Some fields are
 * shown to the driver on the dispatch link page (pickup, drop-off, time,
 * duration, service type, passenger, driver-facing notes); the rest (exec
 * contact, customer account, case code, contract price, private notes) are
 * invisible to the driver. Only a change to a driver-facing field means the
 * driver was told something now stale and must re-confirm the new plan.
 *
 * See docs/shaping/mid-flight-changes.
 */

/**
 * Field labels — exactly as produced by `editBooking`'s `diffFields` — that the
 * driver is shown. NOTE: these strings must track the labels in
 * `services/edit-booking.ts`. A unit test locks the mapping.
 */
export const DRIVER_FACING_CHANGE_LABELS = [
  'service type',
  'pickup time',
  'duration',
  'pickup address',
  'drop-off',
  'passenger name',
  'notes',
] as const;

const DRIVER_FACING = new Set<string>(DRIVER_FACING_CHANGE_LABELS);

/**
 * True when a set of changed-field labels includes anything the driver was told.
 * Drives whether an edit flags the booking for driver re-confirmation. A price-
 * or account-only edit is not material (the driver never sees those).
 */
export function isMaterialChange(changedFields: readonly string[]): boolean {
  return changedFields.some((label) => DRIVER_FACING.has(label));
}

/**
 * Field labels the EXEC was told (in their booking-confirmation message): the
 * pickup time, pickup address and destination. A subset of the driver-facing
 * set. A change to one of these is worth emailing the exec about once the driver
 * has confirmed the new plan; driver-only fields (duration, notes, passenger,
 * service type) are not. NOTE: these must track the labels in
 * `services/edit-booking.ts`.
 */
export const EXEC_FACING_CHANGE_LABELS = ['pickup time', 'pickup address', 'drop-off'] as const;

const EXEC_FACING = new Set<string>(EXEC_FACING_CHANGE_LABELS);

/**
 * True when a change touched something the exec was told (time / pickup /
 * destination). Drives whether confirming the change auto-emails the exec.
 */
export function isExecFacingChange(changedFields: readonly string[]): boolean {
  return changedFields.some((label) => EXEC_FACING.has(label));
}
