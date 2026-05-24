import {
  MIN_QUERY_LENGTH,
  type RawPlacePrediction,
  shouldQueryPlaces,
  toAddressSuggestion,
  toAddressSuggestions,
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
