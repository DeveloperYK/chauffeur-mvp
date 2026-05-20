import { Avatar, UnassignedAvatar } from '@/components/ui/avatar';
import { cn } from '@/lib/cn';
import Link from 'next/link';

export interface FacepileItem {
  /** Stable token used in the URL: operator id, or 'unassigned'. */
  token: string;
  /** Display name (operators) — omitted for the unassigned bucket. */
  name?: string;
  isUnassigned: boolean;
  selected: boolean;
  /** Href that toggles this token in/out of the selection. */
  href: string;
  /** Number of tickets assigned to this person on the board. */
  count: number;
}

/**
 * Jira-style assignee filter facepile.
 *
 * - One avatar per assignee that has a ticket on the board, plus an
 *   "Unassigned" avatar when any ticket is unassigned.
 * - Click an avatar to filter the board to that assignee. Multi-select:
 *   clicking more than one shows tickets for any of them (OR).
 * - Selected avatars get a blue outline ring. The facepile is stable —
 *   selecting one does not remove the others (computed from the full,
 *   unfiltered board).
 */
export function AssigneeFacepile({
  items,
  clearHref,
  anySelected,
}: {
  items: FacepileItem[];
  clearHref: string;
  anySelected: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
        Assignee
      </span>
      <div className="flex items-center">
        {items.map((item, i) => (
          <Link
            key={item.token}
            href={item.href}
            className={cn(
              'relative rounded-full transition-transform hover:z-10 hover:-translate-y-0.5',
              i > 0 && '-ml-2',
            )}
            aria-pressed={item.selected}
          >
            {item.isUnassigned ? (
              <UnassignedAvatar selected={item.selected} />
            ) : (
              <Avatar name={item.name ?? '?'} colorKey={item.token} selected={item.selected} />
            )}
          </Link>
        ))}
      </div>
      {anySelected ? (
        <Link href={clearHref} className="ml-1 text-xs font-medium text-brand-700 hover:underline">
          Clear
        </Link>
      ) : null}
    </div>
  );
}
