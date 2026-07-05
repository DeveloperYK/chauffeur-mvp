import { isRealProduction } from '@/lib/environment';
import { describe, expect, it } from 'vitest';

describe('isRealProduction', () => {
  it('is true only for a production build with auth enforced', () => {
    expect(isRealProduction({ NODE_ENV: 'production', AUTH_DISABLED: false })).toBe(true);
  });

  it('is false on staging (production build but auth bypassed)', () => {
    expect(isRealProduction({ NODE_ENV: 'production', AUTH_DISABLED: true })).toBe(false);
  });

  it('is false in dev and test regardless of the auth flag', () => {
    expect(isRealProduction({ NODE_ENV: 'development', AUTH_DISABLED: false })).toBe(false);
    expect(isRealProduction({ NODE_ENV: 'development', AUTH_DISABLED: true })).toBe(false);
    expect(isRealProduction({ NODE_ENV: 'test', AUTH_DISABLED: false })).toBe(false);
  });
});
