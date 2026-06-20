import { authorizeCronRequest } from '@/server/domain/cron-auth';
import { describe, expect, it } from 'vitest';

const SECRET = 'a-sufficiently-long-cron-secret';

describe('authorizeCronRequest', () => {
  // Happy paths
  it('authorizes a correct Bearer token', () => {
    expect(authorizeCronRequest(`Bearer ${SECRET}`, SECRET)).toEqual({ ok: true });
  });

  it('authorizes regardless of the secret value, as long as it matches', () => {
    const other = 'another-valid-cron-secret-value';
    expect(authorizeCronRequest(`Bearer ${other}`, other)).toEqual({ ok: true });
  });

  // Unhappy paths
  it('disables the endpoint (503) when no secret is configured', () => {
    expect(authorizeCronRequest(`Bearer ${SECRET}`, undefined)).toEqual({
      ok: false,
      status: 503,
      message: 'clock tick disabled',
    });
  });

  it('rejects (401) a missing Authorization header', () => {
    expect(authorizeCronRequest(null, SECRET)).toEqual({
      ok: false,
      status: 401,
      message: 'unauthorized',
    });
  });

  it('rejects (401) a wrong secret', () => {
    expect(authorizeCronRequest('Bearer not-the-secret', SECRET)).toEqual({
      ok: false,
      status: 401,
      message: 'unauthorized',
    });
  });

  it('rejects (401) the raw secret without the Bearer prefix', () => {
    expect(authorizeCronRequest(SECRET, SECRET)).toEqual({
      ok: false,
      status: 401,
      message: 'unauthorized',
    });
  });

  it('rejects (401) a correct secret with a trailing space (no fuzzy match)', () => {
    expect(authorizeCronRequest(`Bearer ${SECRET} `, SECRET)).toEqual({
      ok: false,
      status: 401,
      message: 'unauthorized',
    });
  });
});
