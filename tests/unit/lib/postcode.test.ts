import {
  addressPostcodeErrors,
  extractPostcode,
  hasPostcode,
  isValidUkPostcode,
  withPostcode,
} from '@/lib/postcode';
import { describe, expect, it } from 'vitest';

describe('extractPostcode', () => {
  // Happy paths.
  it('finds a postcode at the end of an address', () => {
    expect(extractPostcode('The Connaught, Carlos Place, London W1K 2AL')).toBe('W1K 2AL');
  });

  it('finds a postcode in the middle of an address', () => {
    expect(extractPostcode('1 Embankment Place, WC2N 6RH, UK')).toBe('WC2N 6RH');
  });

  it('normalises case and spacing', () => {
    expect(extractPostcode('Somewhere n1c4qp London')).toBe('N1C 4QP');
  });

  it('handles every outward-code shape', () => {
    expect(extractPostcode('x, M1 1AA')).toBe('M1 1AA');
    expect(extractPostcode('x, B33 8TH')).toBe('B33 8TH');
    expect(extractPostcode('x, CR2 6XH')).toBe('CR2 6XH');
    expect(extractPostcode('x, DN55 1PT')).toBe('DN55 1PT');
    expect(extractPostcode('x, W1A 0AX')).toBe('W1A 0AX');
    expect(extractPostcode('x, EC1A 1BB')).toBe('EC1A 1BB');
  });

  // Unhappy paths.
  it('returns null when there is no postcode', () => {
    expect(extractPostcode('London St Pancras International, Euston Road, London, UK')).toBeNull();
    expect(extractPostcode('1 Test Street, London')).toBeNull();
    expect(extractPostcode('')).toBeNull();
  });

  it('does not mistake a house number or reference for a postcode', () => {
    expect(extractPostcode('Flat 12, 34 High Street')).toBeNull();
    expect(extractPostcode('Flight BA268 to LAX')).toBeNull();
  });
});

describe('hasPostcode / isValidUkPostcode', () => {
  it('hasPostcode is true only when a postcode is present', () => {
    expect(hasPostcode('The Shard, London SE1 9SG')).toBe(true);
    expect(hasPostcode('The Shard, London')).toBe(false);
  });

  it('isValidUkPostcode accepts a bare postcode in any case/spacing', () => {
    expect(isValidUkPostcode('NW1 2QP')).toBe(true);
    expect(isValidUkPostcode('nw12qp')).toBe(true);
    expect(isValidUkPostcode('  SW1A 1AA ')).toBe(true);
  });

  it('isValidUkPostcode rejects anything that is not exactly one postcode', () => {
    expect(isValidUkPostcode('')).toBe(false);
    expect(isValidUkPostcode('London')).toBe(false);
    expect(isValidUkPostcode('NW1')).toBe(false);
    expect(isValidUkPostcode('NW1 2QP, London')).toBe(false);
  });
});

describe('withPostcode', () => {
  it('appends a normalised postcode and drops the country suffix', () => {
    expect(withPostcode('St Pancras, Euston Road, London, UK', 'n1c4qp')).toBe(
      'St Pancras, Euston Road, London, N1C 4QP',
    );
  });

  it('is a no-op when the postcode is already there or missing', () => {
    expect(withPostcode('1 Embankment Place, WC2N 6RH', 'wc2n 6rh')).toBe(
      '1 Embankment Place, WC2N 6RH',
    );
    expect(withPostcode('Somewhere, London', '')).toBe('Somewhere, London');
    expect(withPostcode('Somewhere, London', null)).toBe('Somewhere, London');
  });
});

describe('addressPostcodeErrors', () => {
  const ok = {
    serviceType: 'transfer',
    pickupAddress: '11 Belsize Park Gardens, London NW3 4AB',
    dropoffAddress: 'Heathrow Terminal 5, London TW6 2GA',
  };

  // Happy paths.
  it('returns no errors when both ends carry a postcode', () => {
    expect(addressPostcodeErrors(ok)).toEqual({});
  });

  it('ignores the drop-off for an hourly hire', () => {
    expect(addressPostcodeErrors({ ...ok, serviceType: 'hourly', dropoffAddress: '' })).toEqual({});
    expect(
      addressPostcodeErrors({ ...ok, serviceType: 'hourly', dropoffAddress: 'Anywhere' }),
    ).toEqual({});
  });

  it('stays silent for an empty address (the required-field rule owns that message)', () => {
    expect(addressPostcodeErrors({ ...ok, pickupAddress: '', dropoffAddress: '  ' })).toEqual({});
  });

  // Unhappy paths.
  it('flags a pickup without a postcode', () => {
    expect(addressPostcodeErrors({ ...ok, pickupAddress: '1 Test Street, London' })).toEqual({
      pickupAddress: 'Pickup address needs a postcode',
    });
  });

  it('flags a transfer drop-off without a postcode', () => {
    expect(addressPostcodeErrors({ ...ok, dropoffAddress: 'Gatwick North Terminal' })).toEqual({
      dropoffAddress: 'Destination needs a postcode',
    });
  });

  it('flags both ends independently', () => {
    expect(
      addressPostcodeErrors({ ...ok, pickupAddress: 'Soho', dropoffAddress: 'Mayfair' }),
    ).toEqual({
      pickupAddress: 'Pickup address needs a postcode',
      dropoffAddress: 'Destination needs a postcode',
    });
  });
});
