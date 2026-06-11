/**
 * A driver's live operational status — "what are they doing right now, and
 * what's next" — for the drivers roster. This replaces the old weekly-load
 * bar: drivers are salaried staff who are told jobs, so the useful question
 * for a dispatcher is their current/next assignment, not a workload fraction.
 *
 * Pure derivation so it can be unit-tested without a DB; the query layer
 * (`driverStatusData`) feeds it one driver's active assignment rows.
 */

export interface DriverStatusRow {
  startMs: number;
  endMs: number;
  pickup: string;
  dropoff: string | null;
}

export interface DriverStatus {
  /** Set when a job is in progress around `now` (window contains it). */
  onJob: { dropoff: string | null; untilMs: number } | null;
  /** The earliest assignment that starts after `now`, if any. */
  next: { atMs: number; pickup: string; dropoff: string | null } | null;
}

/**
 * Derive a driver's current/next status from their active assignment rows.
 * On-a-job wins when a window contains `now` (the longest-running one if
 * several do); `next` is always the earliest future assignment.
 */
export function deriveDriverStatus(rows: readonly DriverStatusRow[], nowMs: number): DriverStatus {
  let onJob: DriverStatus['onJob'] = null;
  let next: DriverStatus['next'] = null;

  for (const r of rows) {
    if (r.startMs <= nowMs && r.endMs > nowMs) {
      if (onJob === null || r.endMs > onJob.untilMs) {
        onJob = { dropoff: r.dropoff, untilMs: r.endMs };
      }
    } else if (r.startMs > nowMs) {
      if (next === null || r.startMs < next.atMs) {
        next = { atMs: r.startMs, pickup: r.pickup, dropoff: r.dropoff };
      }
    }
  }

  return { onJob, next };
}
