'use client';
import { Icon } from '@/components/console/icons';
import type { ConsoleBooking, ConsoleDriver } from '@/components/console/types';
import { useAutoRefresh } from '@/components/console/use-auto-refresh';
import { sectionBookingsForDay } from '@/lib/mobile-sections';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { BookingCard } from './booking-card';

interface DayListProps {
  bookings: ConsoleBooking[];
  drivers: ConsoleDriver[];
  /** Attention view: flat, cross-day list. Day view: sectioned. */
  mode: 'day' | 'attention';
  /** Toast to show once on mount (e.g. after creating a booking). */
  notice?: string | null;
}

const NOTICE_TTL_MS = 2800;

function withoutCreated(pathname: string, params: URLSearchParams): string {
  const rest = new URLSearchParams(params);
  rest.delete('created');
  const qs = rest.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

export function DayList({ bookings, drivers, mode, notice = null }: DayListProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // No input on this screen, so polling never clobbers anything.
  useAutoRefresh(false);
  // The arrival notice ("Booking created.") is rendered straight from props so
  // it is in the first paint; the flag is cleaned off the URL only once the
  // toast has gone — rewriting the URL earlier re-renders the page and would
  // drop the toast with it.
  const [noticeShown, setNoticeShown] = useState(Boolean(notice));
  useEffect(() => {
    if (!notice) return;
    const hide = setTimeout(() => setNoticeShown(false), NOTICE_TTL_MS);
    const clean = setTimeout(
      () => router.replace(withoutCreated(pathname, searchParams), { scroll: false }),
      NOTICE_TTL_MS + 200,
    );
    return () => {
      clearTimeout(hide);
      clearTimeout(clean);
    };
  }, [notice, router, pathname, searchParams]);
  const stack = noticeShown ? (
    <div className="toast-stack" aria-live="polite">
      <div className="toast">
        <Icon.Check /> {notice}
      </div>
    </div>
  ) : null;

  const driverById = useMemo(() => new Map(drivers.map((d) => [d.id, d])), [drivers]);
  const sections = useMemo(() => sectionBookingsForDay(bookings), [bookings]);
  const card = (b: ConsoleBooking) => (
    <BookingCard
      key={b.id}
      booking={b}
      driver={b.assignedDriverId ? driverById.get(b.assignedDriverId) : undefined}
      showDay={mode === 'attention'}
    />
  );

  if (bookings.length === 0) {
    return (
      <>
        <div className="m-empty">
          {mode === 'attention' ? 'Nothing needs your attention.' : 'No bookings on this day.'}
        </div>
        {stack}
      </>
    );
  }

  if (mode === 'attention') {
    return (
      <>
        <div className="m-list" style={{ paddingTop: 12 }}>
          {bookings.map(card)}
        </div>
        {stack}
      </>
    );
  }

  return (
    <>
      {sections.attention.length > 0 ? (
        <>
          <div className="m-section m-section--hot">
            <Icon.Flag style={{ width: 14, height: 14 }} /> Needs you
            <span className="m-section__count">{sections.attention.length}</span>
          </div>
          <div className="m-list">{sections.attention.map(card)}</div>
        </>
      ) : null}
      {sections.scheduled.length > 0 ? (
        <>
          <div className="m-section">
            Scheduled <span className="m-section__count">{sections.scheduled.length}</span>
          </div>
          <div className="m-list">{sections.scheduled.map(card)}</div>
        </>
      ) : null}
      {sections.done.length > 0 ? (
        <>
          <div className="m-section">
            Done <span className="m-section__count">{sections.done.length}</span>
          </div>
          <div className="m-list">{sections.done.map(card)}</div>
        </>
      ) : null}
      <Link className="m-more" href="/dashboard?console=desktop" prefetch={false}>
        Calendar, drivers and invoicing are in the full console
      </Link>
      {stack}
    </>
  );
}
