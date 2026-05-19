import { cn } from '@/lib/cn';
import type { ReactNode } from 'react';

export function Card({
  children,
  className,
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-md border border-border bg-surface shadow-card',
        padded && 'p-4',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <header className={cn('mb-3 flex items-center justify-between gap-3', className)}>
      {children}
    </header>
  );
}

export function CardTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h2 className={cn('text-sm font-semibold uppercase tracking-wide text-ink-subtle', className)}>
      {children}
    </h2>
  );
}
