import { bookingHighlights } from '@/components/console/booking-highlights';
import { describe, expect, it } from 'vitest';

describe('components/console/booking-highlights', () => {
  it('returns a flight tag when the booking has a flight reference', () => {
    expect(
      bookingHighlights({ travelMode: 'flight', travelRef: 'BA268', requestedCarType: null }),
    ).toEqual(['Flight BA268']);
  });

  it('returns a train tag when the booking has a train reference', () => {
    expect(
      bookingHighlights({
        travelMode: 'train',
        travelRef: '12:03 from Leeds',
        requestedCarType: null,
      }),
    ).toEqual(['Train 12:03 from Leeds']);
  });

  it('returns the requested vehicle after the travel tag', () => {
    expect(
      bookingHighlights({ travelMode: 'flight', travelRef: 'BA268', requestedCarType: 'MPV' }),
    ).toEqual(['Flight BA268', 'Requested: MPV']);
  });

  it('returns nothing when the booking has neither', () => {
    expect(
      bookingHighlights({ travelMode: null, travelRef: null, requestedCarType: null }),
    ).toEqual([]);
  });

  it('ignores a blank requested vehicle', () => {
    expect(
      bookingHighlights({ travelMode: null, travelRef: null, requestedCarType: '  ' }),
    ).toEqual([]);
  });

  it('ignores a travel reference without a mode', () => {
    expect(
      bookingHighlights({ travelMode: null, travelRef: 'BA268', requestedCarType: null }),
    ).toEqual([]);
  });
});
