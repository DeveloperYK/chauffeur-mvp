/**
 * One-line description of a journey — "Home → City (wait 40m) → LHR" — shared
 * by the board tile, the list row, the panel hero, driver messages and the
 * calendar entry. Pure: takes the booking's two ends and its ordered stops.
 */

export interface RouteStop {
  /** Order within the journey; omitted stops are taken in array order. */
  seq?: number;
  address: string;
  plannedWaitMinutes: number;
}

export interface RouteLike {
  pickupAddress: string;
  /** Null/empty for an hourly as-directed booking. */
  dropoffAddress: string | null;
  stops: readonly RouteStop[];
}

export interface RouteSummaryOptions {
  /** Truncate each address label to this many characters (with an ellipsis). */
  maxLabel?: number;
}

export const AS_DIRECTED_LABEL = 'As directed';

/** "40m", "1h", "1h 30m". */
export function formatPlannedWait(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** The part of an address before the first comma — enough to recognise it. */
function shortLabel(address: string, maxLabel: number | undefined): string {
  const head = address.split(',')[0]?.trim() || address.trim();
  if (maxLabel == null || head.length <= maxLabel) return head;
  return `${head.slice(0, maxLabel)}…`;
}

/** Stops in journey order: by `seq` when present, else as given. */
export function orderedStops<T extends RouteStop>(stops: readonly T[]): T[] {
  return [...stops].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
}

export function routeSummary(route: RouteLike, opts: RouteSummaryOptions = {}): string {
  const parts: string[] = [shortLabel(route.pickupAddress, opts.maxLabel)];
  for (const stop of orderedStops(route.stops)) {
    const label = shortLabel(stop.address, opts.maxLabel);
    parts.push(
      stop.plannedWaitMinutes > 0
        ? `${label} (wait ${formatPlannedWait(stop.plannedWaitMinutes)})`
        : label,
    );
  }
  const end = route.dropoffAddress?.trim();
  parts.push(end ? shortLabel(end, opts.maxLabel) : AS_DIRECTED_LABEL);
  return parts.join(' → ');
}

/**
 * The journey as message lines: the pickup, then "-> stop (wait ~40 min)" per
 * stop, then "-> destination". One "A -> B" line when there are no stops, so
 * existing single-leg messages read exactly as before.
 */
export function routeLines(route: RouteLike): string[] {
  const end = route.dropoffAddress?.trim() || AS_DIRECTED_LABEL;
  const stops = orderedStops(route.stops);
  if (stops.length === 0) return [`${route.pickupAddress} -> ${end}`];
  return [
    route.pickupAddress,
    ...stops.map((s) =>
      s.plannedWaitMinutes > 0
        ? `-> ${s.address} (wait ~${s.plannedWaitMinutes} min)`
        : `-> ${s.address}`,
    ),
    `-> ${end}`,
  ];
}

/** Planned waiting across the journey, in minutes. */
export function totalPlannedWaitMinutes(stops: readonly RouteStop[]): number {
  return stops.reduce((sum, s) => sum + (s.plannedWaitMinutes || 0), 0);
}
