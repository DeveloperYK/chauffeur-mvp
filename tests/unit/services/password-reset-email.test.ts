import { passwordResetEmail } from '@/server/services/password-reset-email';
import { describe, expect, it } from 'vitest';

const URL = 'https://console.example.com/reset-password?token=abc123';

describe('passwordResetEmail', () => {
  it('addresses the operator by name and includes the link in text and html', () => {
    const m = passwordResetEmail({ name: 'Ozie', resetUrl: URL, expiresMinutes: 30 });
    expect(m.subject).toBe('Reset your JJ Chauffeuring console password');
    expect(m.text).toContain('Ozie');
    expect(m.text).toContain(URL);
    expect(m.html).toContain(`href="${URL}"`);
  });
  it('states the expiry window', () => {
    const m = passwordResetEmail({ name: 'Ozie', resetUrl: URL, expiresMinutes: 30 });
    expect(m.text).toContain('30 minutes');
    expect(m.html).toContain('30 minutes');
  });
  it('tells the reader to ignore the email if they did not ask for it', () => {
    const m = passwordResetEmail({ name: 'Ozie', resetUrl: URL, expiresMinutes: 30 });
    expect(m.text).toMatch(/didn.t (request|ask)/i);
  });
  it('escapes html in the operator name', () => {
    const m = passwordResetEmail({ name: '<b>Oz</b>', resetUrl: URL, expiresMinutes: 30 });
    expect(m.html).not.toContain('<b>Oz</b>');
    expect(m.html).toContain('&lt;b&gt;Oz&lt;/b&gt;');
  });
  it('does not label the footer as a booking notification', () => {
    const m = passwordResetEmail({ name: 'Ozie', resetUrl: URL, expiresMinutes: 30 });
    expect(m.text).not.toContain('Booking notification');
    expect(m.html).not.toContain('Booking notification');
  });
});
