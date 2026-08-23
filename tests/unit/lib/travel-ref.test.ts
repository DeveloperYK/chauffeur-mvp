import { normalizeTravelRef, travelRefLabel } from '@/lib/travel-ref';
import { describe, expect, it } from 'vitest';

describe('normalizeTravelRef — flight', () => {
  // Happy paths
  it('uppercases and strips spaces from an IATA designator', () => {
    expect(normalizeTravelRef('flight', 'ba 268')).toEqual({ ok: true, value: 'BA268' });
  });

  it('accepts an already-normalized designator', () => {
    expect(normalizeTravelRef('flight', 'LH2475')).toEqual({ ok: true, value: 'LH2475' });
  });

  it('accepts an alphanumeric airline code (easyJet U2)', () => {
    expect(normalizeTravelRef('flight', 'u2 8641')).toEqual({ ok: true, value: 'U28641' });
  });

  it('accepts an operational suffix letter', () => {
    expect(normalizeTravelRef('flight', 'BA268A')).toEqual({ ok: true, value: 'BA268A' });
  });

  // Unhappy paths
  it('rejects a bare number (no airline code)', () => {
    expect(normalizeTravelRef('flight', '268').ok).toBe(false);
  });

  it('rejects an empty flight ref', () => {
    expect(normalizeTravelRef('flight', '  ').ok).toBe(false);
  });

  it('rejects free text that is not a designator', () => {
    expect(normalizeTravelRef('flight', 'British Airways to LA').ok).toBe(false);
  });
});

describe('normalizeTravelRef — train', () => {
  // Happy paths
  it('keeps a train arrival reference, trimmed', () => {
    expect(normalizeTravelRef('train', '  12:03 from Manchester Piccadilly ')).toEqual({
      ok: true,
      value: '12:03 from Manchester Piccadilly',
    });
  });

  // Unhappy paths
  it('rejects a train ref that is too short to identify a service', () => {
    expect(normalizeTravelRef('train', 'X').ok).toBe(false);
  });

  it('rejects a train ref over 80 characters', () => {
    expect(normalizeTravelRef('train', 'A'.repeat(81)).ok).toBe(false);
  });
});

describe('travelRefLabel', () => {
  it('labels a flight for driver-facing surfaces', () => {
    expect(travelRefLabel('flight', 'BA268')).toBe('Flight BA268');
  });

  it('labels a train for driver-facing surfaces', () => {
    expect(travelRefLabel('train', '12:03 from Manchester Piccadilly')).toBe(
      'Train 12:03 from Manchester Piccadilly',
    );
  });

  it('is blank when there is no reference', () => {
    expect(travelRefLabel(null, null)).toBe('');
  });
});
