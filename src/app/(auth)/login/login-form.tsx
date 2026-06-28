'use client';

import { Alert } from '@/components/ui/alert';
import { Field } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import { type SVGProps, useId, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { loginAction } from './actions';

const errorMessages: Record<string, string> = {
  invalid_credentials: 'Email or password is incorrect.',
  rate_limited: 'Too many attempts. Wait a minute and try again.',
  validation: 'Please fill out both fields.',
  config: 'Server not configured. Contact your administrator.',
};

const inputClass =
  'form-input h-11 w-full rounded-lg text-[15px] transition-shadow placeholder:text-ink-disabled';

export function LoginForm({ errorCode }: { errorCode: string | undefined }) {
  const message = errorCode ? (errorMessages[errorCode] ?? 'Sign in failed.') : null;
  const [showPassword, setShowPassword] = useState(false);
  const emailId = useId();
  const passwordId = useId();

  return (
    <form action={loginAction} className="flex flex-col gap-4">
      {message ? <Alert tone="danger">{message}</Alert> : null}

      <Field label="Email" htmlFor={emailId} required>
        <input
          id={emailId}
          type="email"
          name="email"
          autoComplete="username"
          placeholder="you@jjchauffeuring.co.uk"
          required
          // biome-ignore lint/a11y/noAutofocus: sign-in is the sole purpose of this screen
          autoFocus
          className={inputClass}
        />
      </Field>

      <Field label="Password" htmlFor={passwordId} required helper="At least 12 characters.">
        <div className="relative">
          <input
            id={passwordId}
            type={showPassword ? 'text' : 'password'}
            name="password"
            autoComplete="current-password"
            placeholder="••••••••••••"
            required
            minLength={12}
            className={cn(inputClass, 'pr-11')}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-pressed={showPassword}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            title={showPassword ? 'Hide password' : 'Show password'}
            className="absolute inset-y-0 right-0 grid w-11 place-items-center text-ink-muted transition-colors hover:text-ink focus-visible:text-ink"
          >
            {showPassword ? (
              <EyeOff className="h-[18px] w-[18px]" />
            ) : (
              <Eye className="h-[18px] w-[18px]" />
            )}
          </button>
        </div>
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
        'group relative mt-1 inline-flex h-11 w-full items-center justify-center gap-2 overflow-hidden rounded-lg',
        'bg-gradient-to-b from-[#17294c] to-[#0b1733] text-sm font-semibold text-white',
        'shadow-[0_8px_20px_-8px_rgba(11,23,51,0.8)] ring-1 ring-inset ring-white/10',
        'transition-[box-shadow,transform] duration-200 hover:shadow-[0_12px_28px_-10px_rgba(11,23,51,0.9)] active:scale-[0.99]',
        'disabled:cursor-not-allowed disabled:opacity-70',
      )}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 w-1/3 -skew-x-12 bg-white/15 opacity-0 blur-md group-hover:animate-auth-sheen group-hover:opacity-100"
      />
      {pending ? <Spinner className="h-4 w-4" /> : null}
      <span className="relative">{pending ? 'Signing in…' : 'Sign in'}</span>
      {pending ? null : (
        <ArrowRight className="relative h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
      )}
    </button>
  );
}

function Eye(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOff(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M3 3l18 18" />
      <path d="M10.6 6.1A9.8 9.8 0 0 1 12 6c6 0 9.5 6 9.5 6a16 16 0 0 1-3 3.5M6.2 7.7A16 16 0 0 0 2.5 12S6 18 12 18a9.4 9.4 0 0 0 3.3-.6" />
      <path d="M9.9 10a3 3 0 0 0 4.2 4.2" />
    </svg>
  );
}

function ArrowRight(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function Spinner(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={cn('animate-spin', props.className)}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" className="opacity-25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
