'use client';

import { Alert } from '@/components/ui/alert';
import { Field } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import { useId } from 'react';
import { useFormStatus } from 'react-dom';
import { forgotPasswordAction } from './actions';

const errorMessages: Record<string, string> = {
  validation: 'Enter the email address you sign in with.',
  rate_limited: 'Too many reset requests. Wait a few minutes and try again.',
  email_failed: 'We could not send the email. Try again or contact your administrator.',
  config: 'Server not configured. Contact your administrator.',
};

const inputClass =
  'form-input h-11 w-full rounded-lg text-[15px] transition-shadow placeholder:text-ink-disabled';

export function ForgotPasswordForm({ errorCode }: { errorCode: string | undefined }) {
  const message = errorCode ? (errorMessages[errorCode] ?? 'Something went wrong.') : null;
  const emailId = useId();

  return (
    <form action={forgotPasswordAction} className="flex flex-col gap-4">
      {message ? <Alert tone="danger">{message}</Alert> : null}

      <Field label="Email" htmlFor={emailId} required>
        <input
          id={emailId}
          type="email"
          name="email"
          autoComplete="username"
          required
          // biome-ignore lint/a11y/noAutofocus: the email field is the only input on this screen
          autoFocus
          className={inputClass}
        />
      </Field>

      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={cn(
        'mt-1 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg',
        'bg-gradient-to-b from-[#17294c] to-[#0b1733] text-sm font-semibold text-white',
        'shadow-[0_8px_20px_-8px_rgba(11,23,51,0.8)] ring-1 ring-inset ring-white/10',
        'transition-[box-shadow,transform] duration-200 active:scale-[0.99]',
        'disabled:cursor-not-allowed disabled:opacity-70',
      )}
    >
      {pending ? 'Sending…' : 'Email me a reset link'}
    </button>
  );
}
