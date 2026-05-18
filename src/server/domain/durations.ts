// Configurable windows live here so they're easy to find. All values in ms.

export const ONE_HOUR_MS = 60 * 60 * 1000;
export const ONE_DAY_MS = 24 * ONE_HOUR_MS;

/** When "Assigned" auto-progresses to "In Progress". */
export const IN_PROGRESS_LEAD_MS = ONE_HOUR_MS;

/** Default auto-flag window when no driver has accepted a link. */
export const DEFAULT_NO_ACCEPT_WINDOW_MS = ONE_DAY_MS;

/** Driver-link token lifetimes from pickup_at. */
export const DISPATCH_LINK_LIFETIME_AFTER_PICKUP_MS = 2 * ONE_DAY_MS;
export const COMPLETION_LINK_LIFETIME_AFTER_PICKUP_MS = 7 * ONE_DAY_MS;

export function dispatchLinkExpiry(pickupAt: Date): Date {
  return new Date(pickupAt.getTime() + DISPATCH_LINK_LIFETIME_AFTER_PICKUP_MS);
}

export function completionLinkExpiry(pickupAt: Date): Date {
  return new Date(pickupAt.getTime() + COMPLETION_LINK_LIFETIME_AFTER_PICKUP_MS);
}

export function inProgressDueAt(pickupAt: Date): Date {
  return new Date(pickupAt.getTime() - IN_PROGRESS_LEAD_MS);
}

export function expectedEndAt(pickupAt: Date, durationMinutes: number): Date {
  return new Date(pickupAt.getTime() + durationMinutes * 60 * 1000);
}
