'use client';

import { cn } from '@/lib/cn';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

export interface NavItem {
  href: string;
  label: string;
  icon?: ReactNode;
}

export function Sidebar({ items, operatorName }: { items: NavItem[]; operatorName: string }) {
  const pathname = usePathname();
  return (
    <aside className="hidden w-56 shrink-0 border-r border-border bg-surface md:block">
      <div className="flex h-12 items-center gap-2 border-b border-border px-4">
        <span className="grid h-7 w-7 place-items-center rounded bg-brand-700 text-xs font-bold text-white">
          CD
        </span>
        <span className="text-sm font-semibold text-ink">Chauffeur Dispatch</span>
      </div>
      <nav className="flex flex-col gap-0.5 p-2">
        {items.map((item) => {
          const active = pathname === item.href || pathname?.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-2 rounded px-3 py-1.5 text-sm font-medium transition-colors',
                active
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-ink-subtle hover:bg-neutral-100 hover:text-ink',
              )}
            >
              {item.icon ? <span className="text-base">{item.icon}</span> : null}
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto border-t border-border px-4 py-3 text-xs text-ink-muted">
        Signed in as <span className="font-medium text-ink">{operatorName}</span>
      </div>
    </aside>
  );
}
