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
 * can render our own dropdown styled to the console. Predictions carry enough
 * text to fill the booking's free-text address field directly, so we never make
 * a billable Place Details call.
 */

export interface AddressSuggestion {
  /** Google `placeId` — stable React key for the option. */
  id: string;
  /** Bold first line, e.g. "The Connaught". */
  primary: string;
  /** Greyed context line, e.g. "Carlos Place, London, UK". */
  secondary: string;
  /** The full string written into the booking field when the option is chosen. */
  full: string;
}

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
}

/** Map a Google `PlacePrediction` to our flat, render-ready suggestion. */
export function toAddressSuggestion(p: RawPlacePrediction): AddressSuggestion {
  const full = p.text?.text?.trim() ?? '';
  const primary = p.mainText?.text?.trim() || full;
  const secondary = p.secondaryText?.text?.trim() ?? '';
  return { id: p.placeId ?? full, primary, secondary, full };
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
 * Fetch UK address predictions for `input`. Resolves to `[]` (never throws) when
 * Places is unavailable or the request is aborted, so callers can render a plain
 * input unchanged.
 */
export async function fetchAddressSuggestions(
  input: string,
  signal?: AbortSignal,
): Promise<AddressSuggestion[]> {
  try {
    const places = await loadPlacesLibrary();
    if (!places?.AutocompleteSuggestion || signal?.aborted) return [];

    const { suggestions } = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
      input,
      includedRegionCodes: INCLUDED_REGION_CODES,
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
