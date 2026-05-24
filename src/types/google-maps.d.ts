/**
 * Minimal ambient types for the Google Maps JS API surface we use: the modern
 * Places (New) Autocomplete *Data* API. Only the members `src/lib/places.ts`
 * touches are declared — this is not the full `@types/google.maps` package.
 *
 * Everything lives inside `declare global` so the `google` namespace is visible
 * across modules (this file is a module because of the `export {}`).
 */
export {};

declare global {
  interface Window {
    google?: typeof google;
  }

  namespace google.maps {
    /** Modern dynamic library loader (bootstrap + `?libraries=places`). */
    function importLibrary(library: 'places'): Promise<typeof google.maps.places>;
  }

  namespace google.maps.places {
    interface FetchAutocompleteSuggestionsRequest {
      input: string;
      includedRegionCodes?: string[];
    }

    interface PlacePrediction {
      placeId?: string;
      text?: { text?: string };
      mainText?: { text?: string };
      secondaryText?: { text?: string };
    }

    interface AutocompleteSuggestionResult {
      placePrediction: PlacePrediction | null;
    }

    // Modelled as a const (not a class) so Biome's no-static-only-class rule is
    // satisfied; at runtime this is `google.maps.places.AutocompleteSuggestion`.
    interface AutocompleteSuggestionStatic {
      fetchAutocompleteSuggestions(
        request: FetchAutocompleteSuggestionsRequest,
      ): Promise<{ suggestions: AutocompleteSuggestionResult[] }>;
    }
    const AutocompleteSuggestion: AutocompleteSuggestionStatic;
  }
}
