/**
 * Drive-time/distance estimate between two addresses, via the Google Maps
 * `DirectionsService` (client-side, reusing the loaded SDK). Used to auto-fill a
 * transfer's duration and feed the price preview. Returns `null` on any failure
 * or when Maps isn't available, so the form degrades to manual entry.
 */

export interface RouteEstimate {
  distanceMeters: number;
  durationMinutes: number;
}

export async function getRouteEstimate(
  origin: string,
  destination: string,
): Promise<RouteEstimate | null> {
  if (typeof window === 'undefined') return null;
  const maps = window.google?.maps;
  if (!maps?.importLibrary) return null;
  if (origin.trim().length < 3 || destination.trim().length < 3) return null;

  try {
    const { DirectionsService } = await maps.importLibrary('routes');
    const service = new DirectionsService();
    const result = await service.route({
      origin,
      destination,
      travelMode: 'DRIVING',
    });
    const leg = result.routes?.[0]?.legs?.[0];
    if (!leg?.distance || !leg?.duration) return null;
    return {
      distanceMeters: leg.distance.value,
      durationMinutes: Math.max(1, Math.round(leg.duration.value / 60)),
    };
  } catch {
    return null;
  }
}
