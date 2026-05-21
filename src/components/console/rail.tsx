'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Icon } from './icons';

export interface SavedView {
  id: string;
  name: string;
  vdot: string;
  urgent?: boolean;
}

export function Rail({
  savedViews,
  counts,
  showSimulator,
}: {
  savedViews: SavedView[];
  counts: Record<string, number>;
  showSimulator: boolean;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeSavedView = searchParams.get('savedView');

  const onBoard = pathname === '/dashboard';
  const isBoardActive = onBoard && !activeSavedView;

  return (
    <aside className="rail">
      <div className="rail__group">
        <Link className={`rail__item ${isBoardActive ? 'is-active' : ''}`} href="/dashboard">
          <Icon.Board /> <span>Board</span>
        </Link>
        <Link
          className={`rail__item ${pathname === '/dashboard/calendar' ? 'is-active' : ''}`}
          href="/dashboard/calendar"
        >
          <Icon.Calendar /> <span>Calendar</span>
        </Link>
        <Link
          className={`rail__item ${pathname?.startsWith('/dashboard/drivers') ? 'is-active' : ''}`}
          href="/dashboard/drivers"
        >
          <Icon.Drivers /> <span>Drivers</span>
        </Link>
        <Link
          className={`rail__item ${pathname === '/dashboard/activity' ? 'is-active' : ''}`}
          href="/dashboard/activity"
        >
          <Icon.List /> <span>Activity</span>
        </Link>
        {showSimulator ? (
          <Link
            className={`rail__item ${pathname === '/dashboard/simulator' ? 'is-active' : ''}`}
            href="/dashboard/simulator"
          >
            <Icon.Settings /> <span>Simulator</span>
          </Link>
        ) : null}
      </div>

      <div className="rail__group">
        <div className="rail__section">Saved views</div>
        {savedViews.map((v) => (
          <Link
            key={v.id}
            className={`rail__item ${onBoard && activeSavedView === v.id ? 'is-active' : ''}`}
            href={`/dashboard?savedView=${v.id}`}
          >
            <span className="vdot" style={{ background: v.vdot }} />
            <span>{v.name}</span>
            <span className={`count ${v.urgent && (counts[v.id] ?? 0) > 0 ? 'urgent' : ''}`}>
              {counts[v.id] ?? 0}
            </span>
          </Link>
        ))}
      </div>

      <div className="rail__footer">
        <button type="button" className="rail__item">
          <Icon.Settings /> <span>Settings</span>
        </button>
      </div>
    </aside>
  );
}
