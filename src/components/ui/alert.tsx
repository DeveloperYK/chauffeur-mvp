import { cn } from '@/lib/cn';
import type { ReactNode } from 'react';

type AlertTone = 'info' | 'success' | 'warning' | 'danger';

const TONE: Record<AlertTone, string> = {
  info: 'bg-info-50 text-info-700 border-info-100',
  success: 'bg-success-50 text-success-700 border-success-100',
  warning: 'bg-warning-50 text-warning-900 border-warning-100',
  danger: 'bg-danger-50 text-danger-700 border-danger-100',
};

export function Alert({
  tone = 'info',
  children,
  className,
}: {
  tone?: AlertTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div role="alert" className={cn('rounded-md border px-3 py-2 text-sm', TONE[tone], className)}>
      {children}
    </div>
  );
}
