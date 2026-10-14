import { parseForgotPasswordForm } from '@/app/(auth)/forgot-password/schema';
import { describe, expect, it } from 'vitest';

describe('forgot-password form schema', () => {
  it('accepts a valid email and lowercases/trims it', () => {
    expect(parseForgotPasswordForm({ email: '  Ozie@Example.com ' })).toEqual({
      ok: true,
      email: 'ozie@example.com',
    });
  });
  it('accepts a plain valid email', () => {
    expect(parseForgotPasswordForm({ email: 'a@b.co' })).toEqual({ ok: true, email: 'a@b.co' });
  });
  it('accepts a long but valid email', () => {
    const email = `${'x'.repeat(60)}@example.com`;
    expect(parseForgotPasswordForm({ email })).toEqual({ ok: true, email });
  });
  it('rejects a missing email', () => {
    expect(parseForgotPasswordForm({ email: null })).toEqual({ ok: false, error: 'validation' });
  });
  it('rejects a malformed email', () => {
    expect(parseForgotPasswordForm({ email: 'not-an-email' })).toEqual({
      ok: false,
      error: 'validation',
    });
  });
  it('rejects unknown fields', () => {
    expect(parseForgotPasswordForm({ email: 'a@b.co', extra: 1 })).toEqual({
      ok: false,
      error: 'validation',
    });
  });
});
