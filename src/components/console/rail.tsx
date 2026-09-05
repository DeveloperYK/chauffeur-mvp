'use client';
import {
  BOARD_QUERY_STORAGE_KEY,
  boardHrefFrom,
  pickBoardParams,
  storedBoardQuery,
} from '@/lib/board-day';
import { londonTodayString } from '@/lib/dates';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
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

  // Remember the day/view the operator last had open on the board so the
  // Board link brings them back to it after a visit to Drivers/Invoicing.
  // Session-scoped and stamped with the London day: a new working day (or a
  // fresh tab) starts back on today. Storage can throw (private windows) —
  // fall back to the plain board link.
  const [boardHref, setBoardHref] = useState('/dashboard');
  useEffect(() => {
    const today = londonTodayString();
    try {
      // Saved-view pages live at /dashboard too but carry no date — don't let
      // them clobber the remembered day.
      if (onBoard && !searchParams.get('savedView')) {
        const qs = pickBoardParams(new URLSearchParams(searchParams.toString()));
        if (qs) sessionStorage.setItem(BOARD_QUERY_STORAGE_KEY, storedBoardQuery(qs, today));
        else sessionStorage.removeItem(BOARD_QUERY_STORAGE_KEY);
      }
      setBoardHref(boardHrefFrom(sessionStorage.getItem(BOARD_QUERY_STORAGE_KEY), today));
    } catch {
      setBoardHref('/dashboard');
    }
  }, [onBoard, searchParams]);

  return (
    <aside className="rail">
      <div className="rail__group">
        <Link
          className={`rail__item ${isBoardActive ? 'is-active' : ''}`}
          href={boardHref}
          prefetch={false}
        >
          <Icon.Board /> <span>Board</span>
        </Link>
        <Link
          className={`rail__item ${pathname === '/dashboard/calendar' ? 'is-active' : ''}`}
          href="/dashboard/calendar"
          prefetch={false}
        >
          <Icon.Calendar /> <span>Calendar</span>
        </Link>
        <Link
          className={`rail__item ${pathname?.startsWith('/dashboard/drivers') ? 'is-active' : ''}`}
          href="/dashboard/drivers"
          prefetch={false}
        >
          <Icon.Drivers /> <span>Drivers</span>
        </Link>
        <Link
          className={`rail__item ${pathname?.startsWith('/dashboard/invoicing') ? 'is-active' : ''}`}
          href="/dashboard/invoicing"
          prefetch={false}
        >
          <Icon.Receipt /> <span>Invoicing</span>
        </Link>
        {showSimulator ? (
          <Link
            className={`rail__item ${pathname === '/dashboard/simulator' ? 'is-active' : ''}`}
            href="/dashboard/simulator"
            prefetch={false}
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
            prefetch={false}
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
