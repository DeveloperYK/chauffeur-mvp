import { parseResetPasswordForm } from '@/app/(auth)/reset-password/schema';
import { describe, expect, it } from 'vitest';

const TOKEN = 'abcDEF123_-xyzABCDEF0123456789abcdefghijklmn';

describe('reset-password form schema', () => {
  it('accepts matching passwords with a token', () => {
    expect(
      parseResetPasswordForm({
        token: TOKEN,
        newPassword: 'longenough1',
        confirmPassword: 'longenough1',
      }),
    ).toEqual({ ok: true, token: TOKEN, newPassword: 'longenough1' });
  });
  it('accepts an 8-character password', () => {
    expect(
      parseResetPasswordForm({
        token: TOKEN,
        newPassword: '12345678',
        confirmPassword: '12345678',
      }),
    ).toEqual({ ok: true, token: TOKEN, newPassword: '12345678' });
  });
  it('accepts a long password', () => {
    const p = 'p'.repeat(100);
    expect(parseResetPasswordForm({ token: TOKEN, newPassword: p, confirmPassword: p })).toEqual({
      ok: true,
      token: TOKEN,
      newPassword: p,
    });
  });
  it('rejects mismatched passwords', () => {
    expect(
      parseResetPasswordForm({
        token: TOKEN,
        newPassword: 'longenough1',
        confirmPassword: 'longenough2',
      }),
    ).toEqual({ ok: false, error: 'mismatch' });
  });
  it('rejects a missing token', () => {
    expect(
      parseResetPasswordForm({
        token: null,
        newPassword: 'longenough1',
        confirmPassword: 'longenough1',
      }),
    ).toEqual({ ok: false, error: 'validation' });
  });
  it('rejects a token with characters outside base64url', () => {
    expect(
      parseResetPasswordForm({
        token: 'bad token!',
        newPassword: 'longenough1',
        confirmPassword: 'longenough1',
      }),
    ).toEqual({ ok: false, error: 'validation' });
  });
  it('rejects a too-short password', () => {
    expect(
      parseResetPasswordForm({ token: TOKEN, newPassword: 'short', confirmPassword: 'short' }),
    ).toEqual({ ok: false, error: 'weak' });
  });
  it('rejects unknown fields', () => {
    expect(
      parseResetPasswordForm({
        token: TOKEN,
        newPassword: 'longenough1',
        confirmPassword: 'longenough1',
        x: 1,
      }),
    ).toEqual({ ok: false, error: 'validation' });
  });
});
