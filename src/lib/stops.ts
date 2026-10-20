/** Limits for a multi-stop journey, shared by the form and the server schema. */

/** Most stops one journey can carry; keeps forms, messages and emails readable. */
export const MAX_STOPS = 8;
/** Matches the booking duration cap: a single planned wait cannot exceed 12 hours. */
export const MAX_PLANNED_WAIT_MINUTES = 720;
