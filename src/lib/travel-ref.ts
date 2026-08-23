/**
 * Structured flight/train reference for airport and station pickups.
 *
 * Captured as data (mode + normalized reference) rather than free text so a
 * future feature can resolve the actual service — a flight-status lookup only
 * needs the IATA designator plus the pickup date the booking already holds.
 */

export type TravelMode = 'flight' | 'train';

export const TRAVEL_MODES: readonly TravelMode[] = ['flight', 'train'];

/**
 * IATA flight designator: 2-character airline code (letters/digits, at least
 * one letter — BA, U2, W6) or 3-letter ICAO code, then a 1–4 digit flight
 * number and an optional operational suffix letter.
 */
const FLIGHT_DESIGNATOR = /^([A-Z][A-Z0-9]|[A-Z0-9][A-Z]|[A-Z]{3})(\d{1,4})([A-Z])?$/;

const TRAIN_REF_MIN = 2;
const TRAVEL_REF_MAX = 80;

export type TravelRefResult = { ok: true; value: string } | { ok: false; error: string };

/**
 * Validate + normalize a travel reference for its mode. Flights are uppercased
 * with spaces removed and must be a real designator; train references are a
 * short arrival description (e.g. "12:03 from Manchester Piccadilly").
 */
export function normalizeTravelRef(mode: TravelMode, raw: string): TravelRefResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: 'Enter the flight or train reference' };
  }
  if (trimmed.length > TRAVEL_REF_MAX) {
    return { ok: false, error: `Keep the reference under ${TRAVEL_REF_MAX} characters` };
  }
  if (mode === 'flight') {
    const compact = trimmed.toUpperCase().replace(/\s+/g, '');
    if (!FLIGHT_DESIGNATOR.test(compact)) {
      return { ok: false, error: 'Enter a flight number like BA268' };
    }
    return { ok: true, value: compact };
  }
  if (trimmed.length < TRAIN_REF_MIN) {
    return { ok: false, error: 'Describe the train arrival, e.g. "12:03 from Manchester"' };
  }
  return { ok: true, value: trimmed };
}

/** Driver-facing label: "Flight BA268" / "Train 12:03 from Manchester". */
export function travelRefLabel(mode: TravelMode | null, ref: string | null): string {
  if (!mode || !ref) return '';
  return `${mode === 'flight' ? 'Flight' : 'Train'} ${ref}`;
}
