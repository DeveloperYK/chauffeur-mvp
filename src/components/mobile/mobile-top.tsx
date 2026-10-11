import { Icon } from '@/components/console/icons';
import Link from 'next/link';
import type { ReactNode } from 'react';

interface MobileTopProps {
  title: string;
  /** Back arrow target; omitted on the home screen (brand mark instead). */
  backHref?: string;
  right?: ReactNode;
}

export function MobileTop({ title, backHref, right }: MobileTopProps) {
  return (
    <header className="m-top">
      {backHref ? (
        <Link className="m-top__back" href={backHref} prefetch={false}>
          <Icon.ChevLeft /> Back
        </Link>
      ) : (
        <div className="m-top__mark" aria-hidden="true">
          JJ
        </div>
      )}
      <div className="m-top__title">{title}</div>
      {right}
    </header>
  );
}
