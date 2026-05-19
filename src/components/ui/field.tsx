import { cn } from '@/lib/cn';
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';

export function Label({
  children,
  htmlFor,
  className,
  required,
}: {
  children: ReactNode;
  htmlFor?: string | undefined;
  className?: string | undefined;
  required?: boolean | undefined;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn('text-xs font-semibold uppercase tracking-wide text-ink-subtle', className)}
    >
      {children}
      {required ? <span className="ml-0.5 text-danger-500">*</span> : null}
    </label>
  );
}

export function Helper({
  children,
  tone = 'muted',
}: {
  children: ReactNode;
  tone?: 'muted' | 'error';
}) {
  return (
    <p className={cn('text-xs', tone === 'error' ? 'text-danger-700' : 'text-ink-muted')}>
      {children}
    </p>
  );
}

interface FieldProps {
  label: string;
  htmlFor?: string;
  required?: boolean;
  helper?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Field({
  label,
  htmlFor,
  required,
  helper,
  error,
  children,
  className,
}: FieldProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={htmlFor} required={required}>
        {label}
      </Label>
      {children}
      {error ? <Helper tone="error">{error}</Helper> : helper ? <Helper>{helper}</Helper> : null}
    </div>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn('form-input w-full', className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn('form-select w-full', className)} {...rest}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn('form-textarea w-full', className)} {...rest} />;
}
