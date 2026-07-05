'use client';

import { Alert } from '@/components/ui/alert';
import { Field } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import { useId, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { changePasswordAction } from './actions';

const errorMessages: Record<string, string> = {
  validation: 'Please enter a new password.',
  weak: 'Your new password must be at least 8 characters.',
  config: 'Server not configured. Contact your administrator.',
  notfound: 'Account not found. Please sign in again.',
};

const inputClass =
  'form-input h-11 w-full rounded-lg text-[15px] transition-shadow placeholder:text-ink-disabled';

export function ChangePasswordForm({
  errorCode,
  forced,
}: {
  errorCode: string | undefined;
  forced: boolean;
}) {
  const message = errorCode
    ? (errorMessages[errorCode] ?? 'Could not update your password.')
    : null;
  const [show, setShow] = useState(false);
  const [next, setNext] = useState('');
  const newId = useId();

  const valid = next.length >= 8;
  const type = show ? 'text' : 'password';

  return (
    <form action={changePasswordAction} className="flex flex-col gap-4">
      {message ? <Alert tone="danger">{message}</Alert> : null}

      <Field label="New password" htmlFor={newId} required helper="At least 8 characters.">
        <input
          id={newId}
          type={type}
          name="newPassword"
          autoComplete="new-password"
          placeholder="Enter your new password"
          required
          minLength={8}
          value={next}
          onChange={(e) => setNext(e.target.value)}
          className={inputClass}
        />
      </Field>

      <label className="flex items-center gap-2 text-sm text-ink-muted">
        <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
        Show password
      </label>

      <SubmitButton disabled={!valid} forced={forced} />
    </form>
  );
}

function SubmitButton({ disabled, forced }: { disabled: boolean; forced: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className={cn(
        'mt-1 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg',
        'bg-gradient-to-b from-[#17294c] to-[#0b1733] text-sm font-semibold text-white',
        'shadow-[0_8px_20px_-8px_rgba(11,23,51,0.8)] ring-1 ring-inset ring-white/10',
        'transition-[box-shadow,transform] duration-200 active:scale-[0.99]',
        'disabled:cursor-not-allowed disabled:opacity-70',
      )}
    >
      <span>{pending ? 'Saving…' : forced ? 'Set password & continue' : 'Update password'}</span>
    </button>
  );
}
