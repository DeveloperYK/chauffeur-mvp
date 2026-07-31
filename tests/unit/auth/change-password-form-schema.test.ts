import { parseChangePasswordForm } from '@/app/(auth)/change-password/schema';
import { describe, expect, it } from 'vitest';

describe('auth/parseChangePasswordForm', () => {
  it('accepts matching new + confirm passwords', () => {
    const r = parseChangePasswordForm({
      newPassword: 'my-real-passw0rd',
      confirmPassword: 'my-real-passw0rd',
    });
    expect(r).toEqual({ ok: true, newPassword: 'my-real-passw0rd' });
  });

  it('accepts a matching pair at the 256-char maximum', () => {
    const long = 'a'.repeat(256);
    const r = parseChangePasswordForm({ newPassword: long, confirmPassword: long });
    expect(r).toEqual({ ok: true, newPassword: long });
  });

  it('accepts a matching pair with special characters', () => {
    const pw = 'p@ss wörd £-!';
    const r = parseChangePasswordForm({ newPassword: pw, confirmPassword: pw });
    expect(r).toEqual({ ok: true, newPassword: pw });
  });

  it('rejects a non-matching confirm password as mismatch', () => {
    const r = parseChangePasswordForm({
      newPassword: 'my-real-passw0rd',
      confirmPassword: 'my-real-passw0rd-typo',
    });
    expect(r).toEqual({ ok: false, error: 'mismatch' });
  });

  it('rejects a missing confirm password as validation', () => {
    const r = parseChangePasswordForm({ newPassword: 'my-real-passw0rd', confirmPassword: null });
    expect(r).toEqual({ ok: false, error: 'validation' });
  });

  it('rejects an empty new password as validation', () => {
    const r = parseChangePasswordForm({ newPassword: '', confirmPassword: '' });
    expect(r).toEqual({ ok: false, error: 'validation' });
  });

  it('rejects a password over 256 chars as validation', () => {
    const tooLong = 'a'.repeat(257);
    const r = parseChangePasswordForm({ newPassword: tooLong, confirmPassword: tooLong });
    expect(r).toEqual({ ok: false, error: 'validation' });
  });

  it('rejects non-string values as validation', () => {
    const r = parseChangePasswordForm({ newPassword: 123, confirmPassword: 123 });
    expect(r).toEqual({ ok: false, error: 'validation' });
  });
});
