/**
 * Google Places (New) address autocomplete — client-safe helpers.
 *
 * The pure functions here (mapping + the query gate) are unit-tested in a node
 * environment, so this module must never touch `window` at import time. The one
 * function that does — `fetchAddressSuggestions` — reads `window.google` only
 * when called in the browser and degrades to `[]` everywhere else, which keeps
 * the UI a plain text input when Places isn't configured (no key, CI, SSR).
 *
 * We use the Autocomplete *Data* API (`AutocompleteSuggestion`) rather than the
 * legacy `Autocomplete` widget (deprecated for new API keys, March 2025) so we
 * can render our own dropdown styled to the console.
 *
 * Prediction text never carries a postcode ("…, Euston Road, London, UK"), and
 * drivers navigate by postcode, so choosing an option makes ONE Place Details
 * call for the `postalCode` and `location` fields (both Essentials SKU).
 * Requests are grouped under an Autocomplete *session token*: every keystroke
 * prediction in the session is then free and only the single details call is
 * billed, which keeps the cost at or below the old per-keystroke pricing.
 *
 * Large POIs (airports, terminals, multi-postcode buildings) often have NO
 * `postalCode` on their Place. For those we reverse-geocode the place's
 * location — in the UK that virtually always yields a postcode — so a lookup
 * selection is guaranteed a postcode without the operator typing one.
 */

import { isValidUkPostcode, withPostcode } from './postcode';

export { withPostcode };

export interface AddressSuggestion {
  /** Google `placeId` — stable React key for the option. */
  id: string;
  /** Bold first line, e.g. "The Connaught". */
  primary: string;
  /** Greyed context line, e.g. "Carlos Place, London, UK". */
  secondary: string;
  /** The full string written into the booking field when the option is chosen. */
  full: string;
  /**
   * Lazily builds a Place bound to this prediction (and its session) so the
   * postcode can be fetched on selection. Absent when Places is unavailable.
   */
  toPlace?: () => PlaceDetailsSource;
}

/**
 * Structural slice of `google.maps.LatLng` — enough to hand the location back
 * to the Geocoder. Kept structural so tests can build fakes without Google.
 */
export interface PlaceLocation {
  lat(): number;
  lng(): number;
}

/** One entry of `Place.addressComponents` (Places New naming). */
export interface PlaceAddressComponent {
  longText?: string | null;
  shortText?: string | null;
  types: string[];
}

/**
 * The slice of `google.maps.places.Place` we need to guarantee a postcode.
 * NOTE: there is no `postalCode` field on Place — requesting one makes
 * `fetchFields` throw "Unknown fields requested". The postcode lives inside
 * `addressComponents` (type `postal_code`).
 */
export interface PlaceDetailsSource {
  fetchFields(request: { fields: string[] }): Promise<{
    place: {
      addressComponents?: PlaceAddressComponent[] | null;
      location?: PlaceLocation | null;
    };
  }>;
}

/** Reverse-geocodes a location to a full UK postcode, `null` when it can't. */
export type PostcodeGeocoder = (location: PlaceLocation) => Promise<string | null>;

/** The slice of a `google.maps.GeocoderResult` we read a postcode from. */
export interface GeocoderResultLike {
  address_components?: Array<{ long_name: string; types: string[] }>;
}

/** Opaque Autocomplete session token; `null` when Places is unavailable. */
export type PlacesSessionToken = google.maps.places.AutocompleteSessionToken | null;

/** Minimum characters before we hit the Places API (cost + noise control). */
export const MIN_QUERY_LENGTH = 3;

/** Restrict predictions to Great Britain — this is a UK chauffeur operation. */
const INCLUDED_REGION_CODES = ['gb'];

/** Whether an input is worth sending to the Places API. */
export function shouldQueryPlaces(input: string): boolean {
  return input.trim().length >= MIN_QUERY_LENGTH;
}

/** Subset of `google.maps.places.PlacePrediction` we depend on. */
export interface RawPlacePrediction {
  placeId?: string;
  text?: { text?: string };
  mainText?: { text?: string };
  secondaryText?: { text?: string };
  toPlace?: () => PlaceDetailsSource;
}

/** Map a Google `PlacePrediction` to our flat, render-ready suggestion. */
export function toAddressSuggestion(p: RawPlacePrediction): AddressSuggestion {
  const full = p.text?.text?.trim() ?? '';
  const primary = p.mainText?.text?.trim() || full;
  const secondary = p.secondaryText?.text?.trim() ?? '';
  const base = { id: p.placeId ?? full, primary, secondary, full };
  // `toPlace` must be invoked as a method on the prediction — bind it.
  return p.toPlace ? { ...base, toPlace: () => p.toPlace?.() as PlaceDetailsSource } : base;
}

/** Normalise a candidate to "TW6 1EW" form, or `null` if not a full UK postcode. */
function normaliseFullPostcode(raw: string): string | null {
  const trimmed = raw.trim();
  if (!isValidUkPostcode(trimmed)) return null;
  const upper = trimmed.toUpperCase().replace(/\s+/g, '');
  return `${upper.slice(0, -3)} ${upper.slice(-3)}`;
}

/**
 * The first full UK postcode in a place's address components, normalised, or
 * `null`. Outward-only codes ("TW6") are not navigable and are skipped.
 */
export function extractComponentPostcode(
  components: PlaceAddressComponent[] | null | undefined,
): string | null {
  for (const component of components ?? []) {
    if (!component.types.includes('postal_code')) continue;
    const raw = component.longText ?? component.shortText ?? '';
    const postcode = normaliseFullPostcode(raw);
    if (postcode) return postcode;
  }
  return null;
}

/**
 * The first full UK postcode found in a set of geocoder results, normalised
 * ("TW6 1EW"), or `null`. Outward-only codes ("TW6") are not navigable and are
 * skipped.
 */
export function extractGeocodedPostcode(results: GeocoderResultLike[]): string | null {
  for (const result of results) {
    for (const component of result.address_components ?? []) {
      if (!component.types.includes('postal_code')) continue;
      const postcode = normaliseFullPostcode(component.long_name);
      if (postcode) return postcode;
    }
  }
  return null;
}

/**
 * Reverse-geocode a place's location to a UK postcode via the Maps JS
 * `Geocoder`. With `loading=async` the constructor may not be on the namespace
 * yet, so fall back to importing the geocoding library. Browser-only; resolves
 * `null` (never throws) on SSR, a missing API, quota/denied errors, or a
 * location with no postcode.
 */
export async function reverseGeocodePostcode(location: PlaceLocation): Promise<string | null> {
  try {
    if (typeof window === 'undefined') return null;
    const maps = window.google?.maps;
    if (!maps) return null;
    let geocoderCtor = maps.Geocoder;
    if (!geocoderCtor && typeof maps.importLibrary === 'function') {
      geocoderCtor = (await maps.importLibrary('geocoding'))?.Geocoder;
    }
    if (!geocoderCtor) return null;
    const { results } = await new geocoderCtor().geocode({ location });
    return extractGeocodedPostcode(results ?? []);
  } catch {
    return null;
  }
}

/**
 * The text to write into the booking once an option is chosen: the prediction
 * text plus a guaranteed postcode — from the place's address components when
 * present, otherwise reverse-geocoded from the place's location (airports and
 * large buildings have no single postcode of their own). Never throws — any
 * failure (no Places, quota, nothing to geocode) falls back to the prediction
 * text so the operator is never blocked.
 */
export async function resolveSelectedAddress(
  s: AddressSuggestion,
  geocodePostcode: PostcodeGeocoder = reverseGeocodePostcode,
): Promise<string> {
  if (!s.toPlace) return s.full;
  try {
    const { place } = await s.toPlace().fetchFields({ fields: ['addressComponents', 'location'] });
    const fromComponents = extractComponentPostcode(place.addressComponents);
    if (fromComponents) return withPostcode(s.full, fromComponents);
    if (place.location) {
      const geocoded = await geocodePostcode(place.location);
      if (geocoded) return withPostcode(s.full, geocoded);
    }
    return s.full;
  } catch {
    return s.full;
  }
}

/** Map an array of predictions, dropping any with no usable text. */
export function toAddressSuggestions(raw: RawPlacePrediction[]): AddressSuggestion[] {
  return raw.map(toAddressSuggestion).filter((s) => s.full.length > 0);
}

/**
 * Resolve the Places library at runtime. Prefers the modern bootstrap
 * (`google.maps.importLibrary`) and falls back to the namespace exposed by the
 * `?libraries=places` script tag. Returns `null` when Places is unavailable.
 */
async function loadPlacesLibrary(): Promise<typeof google.maps.places | null> {
  if (typeof window === 'undefined') return null;
  const maps = window.google?.maps;
  if (!maps) return null;
  if (typeof maps.importLibrary === 'function') {
    return (await maps.importLibrary('places')) ?? null;
  }
  return maps.places ?? null;
}

/**
 * Start a new Autocomplete session. One token spans the keystrokes leading up to
 * a selection plus that selection's Place Details call; Google bills the whole
 * session once. Resolves to `null` when Places is unavailable.
 */
export async function createPlacesSessionToken(): Promise<PlacesSessionToken> {
  try {
    const places = await loadPlacesLibrary();
    return places?.AutocompleteSessionToken ? new places.AutocompleteSessionToken() : null;
  } catch {
    return null;
  }
}

/**
 * Fetch UK address predictions for `input`. Resolves to `[]` (never throws) when
 * Places is unavailable or the request is aborted, so callers can render a plain
 * input unchanged.
 */
export async function fetchAddressSuggestions(
  input: string,
  signal?: AbortSignal,
  sessionToken?: PlacesSessionToken,
): Promise<AddressSuggestion[]> {
  try {
    const places = await loadPlacesLibrary();
    if (!places?.AutocompleteSuggestion || signal?.aborted) return [];

    const { suggestions } = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
      input,
      includedRegionCodes: INCLUDED_REGION_CODES,
      ...(sessionToken ? { sessionToken } : {}),
    });
    if (signal?.aborted) return [];

    const raw = suggestions
      .map((s) => s.placePrediction)
      .filter((p): p is RawPlacePrediction => p != null);
    return toAddressSuggestions(raw);
  } catch {
    // A failed lookup must never block manual entry — the typed text still saves.
    return [];
  }
}
