declare global {
  interface Window {
    google?: {
      maps?: {
        places?: {
          Autocomplete: new (
            input: HTMLInputElement,
            options?: google.maps.places.AutocompleteOptions,
          ) => google.maps.places.Autocomplete;
        };
      };
    };
  }
}

declare namespace google.maps.places {
  interface AutocompleteOptions {
    componentRestrictions?: { country: string | string[] };
    fields?: string[];
    types?: string[];
  }

  interface Autocomplete {
    addListener(event: 'place_changed', callback: () => void): void;
    getPlace(): PlaceResult;
  }

  interface PlaceResult {
    formatted_address?: string;
    name?: string;
    geometry?: {
      location?: {
        lat(): number;
        lng(): number;
      };
    };
  }
}

export {};
