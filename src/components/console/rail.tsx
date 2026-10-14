'use client';

import { ACTION_VIEWS, ACTION_VIEW_GROUPS, type ActionViewCounts } from '@/lib/action-views';
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

export function Rail({
  counts,
  showSimulator,
}: {
  counts: ActionViewCounts;
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

      {/* Action views: one group per kind of attention, each item an imperative
          naming the operator's next step, with the number of bookings waiting
          for it. Red only when something is actually overdue (ADR 0021). */}
      {ACTION_VIEW_GROUPS.map((group) => (
        <div className="rail__group" key={group.id}>
          <div className="rail__section">{group.label}</div>
          {ACTION_VIEWS.filter((v) => v.group === group.id).map((v) => {
            const c = counts[v.id];
            return (
              <Link
                key={v.id}
                className={`rail__item ${onBoard && activeSavedView === v.id ? 'is-active' : ''}`}
                href={`/dashboard?savedView=${v.id}`}
                prefetch={false}
                title={v.subtitle}
              >
                <span className="vdot" style={{ background: v.vdot }} />
                <span>{v.name}</span>
                <span className={`count ${c.urgent > 0 ? 'urgent' : ''}`}>{c.total}</span>
              </Link>
            );
          })}
        </div>
      ))}

      <div className="rail__footer">
        <button type="button" className="rail__item">
          <Icon.Settings /> <span>Settings</span>
        </button>
        {/* Phones that opted into the full console get a way back to the shell. */}
        <a className="rail__item rail__item--mobile-only" href="/m?console=mobile">
          <Icon.Board /> <span>Mobile view</span>
        </a>
      </div>
    </aside>
  );
}
