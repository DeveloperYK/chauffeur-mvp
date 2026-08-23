/**
 * Route distance display. The route estimate arrives from Google in metres;
 * the operators (and the JJ billing sheet) work in miles.
 */

const METERS_PER_MILE = 1609.344;

/**
 * Metres → miles with 1 decimal, as a string ("17.4"). Blank when there is no
 * usable distance (null, negative or NaN) — hourly as-directed jobs have no
 * route, so their Mileage cell stays empty.
 */
export function milesStringFromMeters(meters: number | null): string {
  if (meters == null || Number.isNaN(meters) || meters < 0) return '';
  return (meters / METERS_PER_MILE).toFixed(1);
}

/** Metres → "17.4 mi" for UI labels; blank when there is no distance. */
export function formatMiles(meters: number | null): string {
  const miles = milesStringFromMeters(meters);
  return miles === '' ? '' : `${miles} mi`;
}
