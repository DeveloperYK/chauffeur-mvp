/**
 * Drive-time/distance estimate for a journey — pickup, optional intermediate
 * stops, destination — via the Google Maps `DirectionsService` (client-side,
 * reusing the loaded SDK). One request with the stops as `waypoints` returns a
 * leg per segment; the totals are the sums. Used to auto-fill a transfer's
 * duration and feed the price preview. Returns `null` on any failure or when
 * Maps isn't available, so the form degrades to manual entry.
 */

export interface RouteEstimate {
  /** Sum of every leg's distance. */
  distanceMeters: number;
  /** Sum of every leg's drive time (planned waits are NOT included). */
  durationMinutes: number;
  /** Number of legs = stops + 1. */
  legs: number;
}

export async function getRouteEstimate(
  origin: string,
  destination: string,
  waypoints: readonly string[] = [],
): Promise<RouteEstimate | null> {
  if (typeof window === 'undefined') return null;
  const maps = window.google?.maps;
  if (!maps?.importLibrary) return null;
  if (origin.trim().length < 3 || destination.trim().length < 3) return null;
  const via = waypoints.map((w) => w.trim()).filter((w) => w.length >= 3);

  try {
    const { DirectionsService } = await maps.importLibrary('routes');
    const service = new DirectionsService();
    const result = await service.route({
      origin,
      destination,
      travelMode: 'DRIVING',
      ...(via.length > 0
        ? { waypoints: via.map((location) => ({ location, stopover: true })) }
        : {}),
    });
    const legs = result.routes?.[0]?.legs ?? [];
    if (legs.length === 0 || legs.some((leg) => !leg.distance || !leg.duration)) return null;
    const distanceMeters = legs.reduce((sum, leg) => sum + (leg.distance?.value ?? 0), 0);
    const seconds = legs.reduce((sum, leg) => sum + (leg.duration?.value ?? 0), 0);
    return {
      distanceMeters,
      durationMinutes: Math.max(1, Math.round(seconds / 60)),
      legs: legs.length,
    };
  } catch {
    return null;
  }
}
