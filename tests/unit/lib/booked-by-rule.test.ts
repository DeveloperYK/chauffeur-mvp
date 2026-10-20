import {
  BOOKED_BY_EMAIL_MESSAGE,
  BOOKED_BY_NAME_MESSAGE,
  bookedByErrors,
} from '@/lib/booked-by-rule';
import { describe, expect, it } from 'vitest';

/**
 * The "Booked by (PA)" section is mandatory on the operator forms: every
 * booking needs the PA's name and email (the confirmation email goes to the
 * PA). The phone stays optional.
 */
describe('bookedByErrors', () => {
  // Happy paths.
  it('passes with a name and an email', () => {
    expect(bookedByErrors({ bookedByName: 'Sandra Miles', bookedByEmail: 'sandra@x.com' })).toEqual(
      {},
    );
  });

  it('passes with a name, email and phone', () => {
    expect(
      bookedByErrors({
        bookedByName: 'Sandra Miles',
        bookedByEmail: 'sandra@x.com',
        bookedByPhone: '+447700900123',
      }),
    ).toEqual({});
  });

  it('ignores surrounding whitespace', () => {
    expect(bookedByErrors({ bookedByName: '  Sandra ', bookedByEmail: ' sandra@x.com ' })).toEqual(
      {},
    );
  });

  // Unhappy paths.
  it('requires the email when everything is blank', () => {
    expect(bookedByErrors({})).toEqual({
      bookedByName: BOOKED_BY_NAME_MESSAGE,
      bookedByEmail: BOOKED_BY_EMAIL_MESSAGE,
    });
  });

  it('requires the email even when a phone is given', () => {
    expect(
      bookedByErrors({ bookedByName: 'Sandra', bookedByPhone: '+447700900123', bookedByEmail: '' }),
    ).toEqual({ bookedByEmail: BOOKED_BY_EMAIL_MESSAGE });
  });

  it('requires the name when only the email is given', () => {
    expect(bookedByErrors({ bookedByName: null, bookedByEmail: 'sandra@x.com' })).toEqual({
      bookedByName: BOOKED_BY_NAME_MESSAGE,
    });
  });

  it('treats whitespace-only values as blank', () => {
    expect(bookedByErrors({ bookedByName: '   ', bookedByEmail: '  ' })).toEqual({
      bookedByName: BOOKED_BY_NAME_MESSAGE,
      bookedByEmail: BOOKED_BY_EMAIL_MESSAGE,
    });
  });
});
