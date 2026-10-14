import { type RenderedEmail, renderBrandedEmail } from './email-templates';

export interface PasswordResetEmailInput {
  name: string;
  resetUrl: string;
  expiresMinutes: number;
}

/**
 * The "forgot your password" email. Only the operator's display name and the
 * signed reset URL are interpolated, both escaped by the renderer.
 */
export function passwordResetEmail(input: PasswordResetEmailInput): RenderedEmail {
  return renderBrandedEmail('Reset your JJ Chauffeuring console password', {
    heading: 'Reset your password',
    intro: [
      `Hi ${input.name},`,
      '',
      'We received a request to reset the password for your operator console account.',
      `Use the link below to choose a new one. It expires in ${input.expiresMinutes} minutes and can only be used once.`,
    ].join('\n'),
    rows: [],
    cta: { url: input.resetUrl, label: 'Choose a new password' },
    closing:
      "If you didn't request this, you can ignore this email — your password will stay the same.",
    footerLabel: 'Account security',
  });
}
