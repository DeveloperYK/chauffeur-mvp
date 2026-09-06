import {
  type AddressSuggestion,
  type GeocoderResultLike,
  MIN_QUERY_LENGTH,
  type PlaceDetailsSource,
  type PlaceLocation,
  type RawPlacePrediction,
  extractGeocodedPostcode,
  resolveSelectedAddress,
  reverseGeocodePostcode,
  shouldQueryPlaces,
  toAddressSuggestion,
  toAddressSuggestions,
  withPostcode,
} from '@/lib/places';
import { describe, expect, it } from 'vitest';

describe('shouldQueryPlaces', () => {
  // Happy paths — worth sending to the Places API.
  it('returns true for input at the minimum length', () => {
    expect(shouldQueryPlaces('W1K')).toBe(true);
    expect('W1K'.length).toBe(MIN_QUERY_LENGTH);
  });

  it('returns true for a longer query', () => {
    expect(shouldQueryPlaces('The Connaught')).toBe(true);
  });

  it('counts characters after trimming surrounding whitespace', () => {
    expect(shouldQueryPlaces('  Soho  ')).toBe(true);
  });

  // Unhappy paths — not worth a request.
  it('returns false for an empty string', () => {
    expect(shouldQueryPlaces('')).toBe(false);
  });

  it('returns false for whitespace only', () => {
    expect(shouldQueryPlaces('   ')).toBe(false);
  });

  it('returns false for input shorter than the minimum', () => {
    expect(shouldQueryPlaces('ab')).toBe(false);
  });
});

describe('toAddressSuggestion', () => {
  it('maps a full prediction to a flat suggestion', () => {
    const raw: RawPlacePrediction = {
      placeId: 'pid-1',
      text: { text: 'The Connaught, Carlos Place, London, UK' },
      mainText: { text: 'The Connaught' },
      secondaryText: { text: 'Carlos Place, London, UK' },
    };
    expect(toAddressSuggestion(raw)).toEqual({
      id: 'pid-1',
      primary: 'The Connaught',
      secondary: 'Carlos Place, London, UK',
      full: 'The Connaught, Carlos Place, London, UK',
    });
  });

  it('falls back to the full text when mainText is missing', () => {
    const raw: RawPlacePrediction = {
      placeId: 'pid-2',
      text: { text: 'Heathrow Terminal 5' },
    };
    const s = toAddressSuggestion(raw);
    expect(s.primary).toBe('Heathrow Terminal 5');
    expect(s.secondary).toBe('');
    expect(s.full).toBe('Heathrow Terminal 5');
  });

  it('falls back to the full text for the id when placeId is missing', () => {
    const raw: RawPlacePrediction = { text: { text: 'Gatwick North Terminal' } };
    expect(toAddressSuggestion(raw).id).toBe('Gatwick North Terminal');
  });

  it('trims whitespace on each field', () => {
    const raw: RawPlacePrediction = {
      placeId: 'pid-3',
      text: { text: '  1 Embankment Place, WC2N 6RH  ' },
      mainText: { text: '  1 Embankment Place  ' },
      secondaryText: { text: '  WC2N 6RH  ' },
    };
    const s = toAddressSuggestion(raw);
    expect(s.full).toBe('1 Embankment Place, WC2N 6RH');
    expect(s.primary).toBe('1 Embankment Place');
    expect(s.secondary).toBe('WC2N 6RH');
  });
});

describe('toAddressSuggestions', () => {
  it('maps an array of predictions', () => {
    const raw: RawPlacePrediction[] = [
      { placeId: 'a', text: { text: 'Alpha House, London' }, mainText: { text: 'Alpha House' } },
      { placeId: 'b', text: { text: 'Beta Tower, Leeds' }, mainText: { text: 'Beta Tower' } },
    ];
    const out = toAddressSuggestions(raw);
    expect(out).toHaveLength(2);
    expect(out[0]?.full).toBe('Alpha House, London');
    expect(out[1]?.primary).toBe('Beta Tower');
  });

  it('drops predictions with no usable text', () => {
    const raw: RawPlacePrediction[] = [
      { placeId: 'a', text: { text: 'Real Place' } },
      { placeId: 'b' },
      { placeId: 'c', text: { text: '   ' } },
    ];
    const out = toAddressSuggestions(raw);
    expect(out).toHaveLength(1);
    expect(out[0]?.full).toBe('Real Place');
  });

  it('returns an empty array for empty input', () => {
    expect(toAddressSuggestions([])).toEqual([]);
  });
});

describe('withPostcode', () => {
  // Happy paths.
  it('appends the postcode when the prediction text lacks one', () => {
    expect(
      withPostcode('London St Pancras International, Euston Road, London, UK', 'N1C 4QP'),
    ).toBe('London St Pancras International, Euston Road, London, N1C 4QP');
  });

  it('strips a trailing "United Kingdom" before appending', () => {
    expect(withPostcode('The Connaught, Carlos Place, London, United Kingdom', 'W1K 2AL')).toBe(
      'The Connaught, Carlos Place, London, W1K 2AL',
    );
  });

  it('appends when there is no country suffix at all', () => {
    expect(withPostcode('Heathrow Terminal 5', 'TW6 2GA')).toBe('Heathrow Terminal 5, TW6 2GA');
  });

  // Unhappy paths / no-ops.
  it('leaves the text unchanged when the postcode is already present', () => {
    expect(withPostcode('1 Embankment Place, WC2N 6RH, UK', 'WC2N 6RH')).toBe(
      '1 Embankment Place, WC2N 6RH, UK',
    );
  });

  it('detects an existing postcode regardless of case and spacing', () => {
    expect(withPostcode('1 Embankment Place, wc2n6rh', 'WC2N 6RH')).toBe(
      '1 Embankment Place, wc2n6rh',
    );
  });

  it('returns the text unchanged when the postcode is missing or blank', () => {
    expect(withPostcode('Somewhere, London, UK', null)).toBe('Somewhere, London, UK');
    expect(withPostcode('Somewhere, London, UK', undefined)).toBe('Somewhere, London, UK');
    expect(withPostcode('Somewhere, London, UK', '   ')).toBe('Somewhere, London, UK');
  });
});

describe('resolveSelectedAddress', () => {
  const base: AddressSuggestion = {
    id: 'pid-1',
    primary: 'London St Pancras International',
    secondary: 'Euston Road, London, UK',
    full: 'London St Pancras International, Euston Road, London, UK',
  };

  const heathrow: PlaceLocation = { lat: () => 51.470022, lng: () => -0.454295 };

  /** Address components as the live Places (New) API returns them. */
  const pcComponent = (postcode: string) => ({
    longText: postcode,
    types: ['postal_code'],
  });
  const townComponent = { longText: 'London', types: ['postal_town'] };

  const fakePlace = (
    postcode: string | null,
    location: PlaceLocation | null = null,
  ): PlaceDetailsSource => ({
    fetchFields: async () => ({
      place: {
        addressComponents: postcode ? [townComponent, pcComponent(postcode)] : [townComponent],
        location,
      },
    }),
  });

  /** Geocoder double that records whether it was called. */
  const fakeGeocoder = (postcode: string | null) => {
    const calls: PlaceLocation[] = [];
    const geocode = async (location: PlaceLocation) => {
      calls.push(location);
      return postcode;
    };
    return { geocode, calls };
  };

  // Happy paths.
  it('appends the postcode found in the address components', async () => {
    const s = { ...base, toPlace: () => fakePlace('N1C 4QP') };
    await expect(resolveSelectedAddress(s)).resolves.toBe(
      'London St Pancras International, Euston Road, London, N1C 4QP',
    );
  });

  it('requests the address components and location fields in one details call', async () => {
    // 'postalCode' is NOT a valid Place field — requesting it makes fetchFields
    // throw ("Unknown fields requested") and silently breaks the whole chain.
    let requested: string[] = [];
    const s = {
      ...base,
      toPlace: (): PlaceDetailsSource => ({
        fetchFields: async (req) => {
          requested = req.fields;
          return { place: { addressComponents: [pcComponent('N1C 4QP')] } };
        },
      }),
    };
    await resolveSelectedAddress(s);
    expect(requested).toEqual(['addressComponents', 'location']);
  });

  it('reads a shortText-only postal component', async () => {
    const s = {
      ...base,
      toPlace: (): PlaceDetailsSource => ({
        fetchFields: async () => ({
          place: { addressComponents: [{ shortText: 'n1c 4qp', types: ['postal_code'] }] },
        }),
      }),
    };
    await expect(resolveSelectedAddress(s)).resolves.toBe(
      'London St Pancras International, Euston Road, London, N1C 4QP',
    );
  });

  it('does not reverse-geocode when the components already carry a postcode', async () => {
    const geo = fakeGeocoder('XX1 1XX');
    const s = { ...base, toPlace: () => fakePlace('N1C 4QP', heathrow) };
    await expect(resolveSelectedAddress(s, geo.geocode)).resolves.toBe(
      'London St Pancras International, Euston Road, London, N1C 4QP',
    );
    expect(geo.calls).toHaveLength(0);
  });

  it('falls back to reverse geocoding when the place has no postcode (airports)', async () => {
    const geo = fakeGeocoder('TW6 1EW');
    const s = {
      ...base,
      full: 'Heathrow Airport, Hounslow, UK',
      toPlace: () => fakePlace(null, heathrow),
    };
    await expect(resolveSelectedAddress(s, geo.geocode)).resolves.toBe(
      'Heathrow Airport, Hounslow, TW6 1EW',
    );
    expect(geo.calls).toEqual([heathrow]);
  });

  it('treats an outward-only component ("TW6") as no postcode and geocodes instead', async () => {
    const geo = fakeGeocoder('TW6 1EW');
    const s = {
      ...base,
      full: 'Heathrow Airport, Hounslow, UK',
      toPlace: (): PlaceDetailsSource => ({
        fetchFields: async () => ({
          place: {
            addressComponents: [{ longText: 'TW6', types: ['postal_code'] }],
            location: heathrow,
          },
        }),
      }),
    };
    await expect(resolveSelectedAddress(s, geo.geocode)).resolves.toBe(
      'Heathrow Airport, Hounslow, TW6 1EW',
    );
  });

  it('keeps the text unchanged when the postcode is already in it', async () => {
    const s = {
      ...base,
      full: '1 Embankment Place, WC2N 6RH, UK',
      toPlace: () => fakePlace('WC2N 6RH'),
    };
    await expect(resolveSelectedAddress(s)).resolves.toBe('1 Embankment Place, WC2N 6RH, UK');
  });

  // Unhappy paths — never block the operator; fall back to the prediction text.
  it('falls back to the prediction text when the suggestion cannot resolve a place', async () => {
    await expect(resolveSelectedAddress(base)).resolves.toBe(base.full);
  });

  it('falls back when there is no postcode and no location to geocode', async () => {
    const geo = fakeGeocoder('TW6 1EW');
    const s = { ...base, toPlace: () => fakePlace(null, null) };
    await expect(resolveSelectedAddress(s, geo.geocode)).resolves.toBe(base.full);
    expect(geo.calls).toHaveLength(0);
  });

  it('falls back when reverse geocoding finds no postcode', async () => {
    const geo = fakeGeocoder(null);
    const s = { ...base, toPlace: () => fakePlace(null, heathrow) };
    await expect(resolveSelectedAddress(s, geo.geocode)).resolves.toBe(base.full);
    expect(geo.calls).toHaveLength(1);
  });

  it('falls back when reverse geocoding throws', async () => {
    const s = { ...base, toPlace: () => fakePlace(null, heathrow) };
    const throwingGeocode = async (): Promise<string | null> => {
      throw new Error('geocode quota');
    };
    await expect(resolveSelectedAddress(s, throwingGeocode)).resolves.toBe(base.full);
  });

  it('falls back when Place Details throws', async () => {
    const s = {
      ...base,
      toPlace: (): PlaceDetailsSource => ({
        fetchFields: async () => {
          throw new Error('quota');
        },
      }),
    };
    await expect(resolveSelectedAddress(s)).resolves.toBe(base.full);
  });
});

describe('extractGeocodedPostcode', () => {
  const result = (
    components: Array<{ long_name: string; types: string[] }>,
  ): GeocoderResultLike => ({
    address_components: components,
  });

  // Happy paths.
  it('returns the postal code component of the first result', () => {
    const results = [
      result([
        { long_name: 'Hounslow', types: ['postal_town'] },
        { long_name: 'TW6 1EW', types: ['postal_code'] },
      ]),
    ];
    expect(extractGeocodedPostcode(results)).toBe('TW6 1EW');
  });

  it('skips results without a postal code and reads a later one', () => {
    const results = [
      result([{ long_name: 'England', types: ['administrative_area_level_1'] }]),
      result([{ long_name: 'N1C 4QP', types: ['postal_code'] }]),
    ];
    expect(extractGeocodedPostcode(results)).toBe('N1C 4QP');
  });

  it('normalises case and spacing of the found postcode', () => {
    const results = [result([{ long_name: 'tw61ew', types: ['postal_code'] }])];
    expect(extractGeocodedPostcode(results)).toBe('TW6 1EW');
  });

  // Unhappy paths.
  it('returns null for no results', () => {
    expect(extractGeocodedPostcode([])).toBeNull();
  });

  it('returns null when no result carries a postal code', () => {
    const results = [result([{ long_name: 'London', types: ['postal_town'] }])];
    expect(extractGeocodedPostcode(results)).toBeNull();
  });

  it('ignores partial outward-only codes (not navigable postcodes)', () => {
    const results = [result([{ long_name: 'TW6', types: ['postal_code'] }])];
    expect(extractGeocodedPostcode(results)).toBeNull();
  });

  it('returns null when address components are missing entirely', () => {
    expect(extractGeocodedPostcode([{}])).toBeNull();
  });
});

describe('reverseGeocodePostcode', () => {
  it('resolves null outside the browser (no window/google)', async () => {
    const location: PlaceLocation = { lat: () => 51.5, lng: () => -0.1 };
    await expect(reverseGeocodePostcode(location)).resolves.toBeNull();
  });
});
