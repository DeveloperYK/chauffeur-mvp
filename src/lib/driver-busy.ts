/**
 * Driver "busy at this pickup time" detection for the dispatch picker.
 *
 * Internal drivers are salaried and simply told jobs, so there is no workload
 * score — the only thing an operator needs at dispatch time is whether the
 * candidate driver is already committed around the pickup. A driver is "busy"
 * when one of their active assignment windows overlaps the candidate pickup
 * window, or sits within {@link BUSY_BUFFER_MS} either side of it (a job that
 * ends or starts within half an hour is too close to safely take this one).
 *
 * This only flags — it never blocks. The operator can still send to a busy
 * driver; the flag just makes the clash obvious.
 */

/** A job finishing/starting within this gap of the candidate counts as busy. */
export const BUSY_BUFFER_MS = 30 * 60_000;

export interface BusyWindow {
  startMs: number;
  endMs: number;
}

/**
 * The earliest of `windows` that clashes with the candidate pickup window —
 * overlapping it or within `bufferMs` either side — or `null` if none clash.
 * Returning the window (not just a boolean) lets the caller show *when* the
 * driver is busy.
 */
export function firstClashingWindow(
  windows: readonly BusyWindow[],
  candidateStartMs: number,
  candidateEndMs: number,
  bufferMs: number = BUSY_BUFFER_MS,
): BusyWindow | null {
  let earliest: BusyWindow | null = null;
  for (const w of windows) {
    const clashes = w.startMs < candidateEndMs + bufferMs && w.endMs > candidateStartMs - bufferMs;
    if (clashes && (earliest === null || w.startMs < earliest.startMs)) {
      earliest = w;
    }
  }
  return earliest;
}
