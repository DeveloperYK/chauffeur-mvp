import { type TravelMode, travelRefLabel } from '@/lib/travel-ref';

/** The subset of a booking the board card needs for its travel/vehicle tags. */
export interface BookingHighlightSource {
  travelMode: TravelMode | null;
  travelRef: string | null;
  requestedCarType: string | null;
}

/**
 * Short tags a booking card shows under the route so the operator can see at
 * a glance that a job is an airport/station meet ("Flight BA268") or needs a
 * particular vehicle class ("Requested: MPV"). Empty when neither applies.
 */
export function bookingHighlights(b: BookingHighlightSource): string[] {
  const travel = travelRefLabel(b.travelMode, b.travelRef?.trim() || null);
  const requested = b.requestedCarType?.trim();
  return [...(travel ? [travel] : []), ...(requested ? [`Requested: ${requested}`] : [])];
}
