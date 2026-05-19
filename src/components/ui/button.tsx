import { cn } from '@/lib/cn';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type ButtonSize = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconLeft?: ReactNode;
}

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-700 text-white hover:bg-brand-800 active:bg-brand-900 disabled:bg-neutral-200 disabled:text-ink-disabled',
  secondary:
    'bg-neutral-100 text-ink hover:bg-neutral-200 active:bg-neutral-300 disabled:bg-neutral-50 disabled:text-ink-disabled',
  ghost:
    'bg-transparent text-ink hover:bg-neutral-100 active:bg-neutral-200 disabled:text-ink-disabled',
  danger:
    'bg-danger-500 text-white hover:bg-danger-700 active:bg-danger-900 disabled:bg-neutral-200 disabled:text-ink-disabled',
  success:
    'bg-success-500 text-white hover:bg-success-700 active:bg-success-900 disabled:bg-neutral-200 disabled:text-ink-disabled',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-xs',
  md: 'h-9 px-3.5 text-sm',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  iconLeft,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded font-medium transition-colors',
        'disabled:cursor-not-allowed',
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    >
      {iconLeft ? <span className="-ml-0.5 flex items-center">{iconLeft}</span> : null}
      {children}
    </button>
  );
}
