import { Icon } from '@/components/console/icons';
import { DayList } from '@/components/mobile/day-list';
import { MobileTop } from '@/components/mobile/mobile-top';
import {
  addDaysToDayString,
  formatLondonDayLong,
  londonTodayString,
  parseDayString,
} from '@/lib/dates';
import { env } from '@/lib/env';
import { currentSession } from '@/server/auth/current';
import { getDb, resetDb } from '@/server/db';
import { DB_TIMEOUT_MS, withDbTimeout } from '@/server/db/timeout';
import { loadAttentionView, loadDayView } from '@/server/services/console-view';
import Link from 'next/link';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export default async function MobileHome({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; view?: string; created?: string }>;
}) {
  const session = await currentSession();
  if (!session) redirect('/login');
  const url = env().DATABASE_URL;
  if (!url) return <div className="m-empty">DATABASE_URL not configured.</div>;
  const { db } = getDb(url);

  const params = await searchParams;
  const today = londonTodayString();
  const day = params.date && parseDayString(params.date) ? params.date : today;
  const attentionMode = params.view === 'attention';
  const notice = params.created === '1' ? 'Booking created.' : null;

  const [dayView, attention] = await withDbTimeout(
    'mobile home',
    DB_TIMEOUT_MS.page,
    () => Promise.all([attentionMode ? null : loadDayView(db, day), loadAttentionView(db)]),
    resetDb,
  );

  const newButton = (
    <div className="m-fab">
      <Link className="m-btn m-btn--primary m-btn--lg" href="/m/new" prefetch={false}>
        <Icon.Plus /> New booking
      </Link>
    </div>
  );

  if (attentionMode || !dayView) {
    return (
      <>
        <MobileTop title="Needs attention" backHref="/m" />
        <DayList bookings={attention.bookings} drivers={attention.drivers} mode="attention" />
        {newButton}
      </>
    );
  }

  const prev = addDaysToDayString(day, -1) ?? day;
  const next = addDaysToDayString(day, 1) ?? day;
  const isToday = day === today;
  return (
    <>
      <MobileTop
        title="JJ Chauffeuring"
        right={
          <a className="m-top__link" href="/dashboard?console=desktop">
            Full console
          </a>
        }
      />
      <nav className="m-day" aria-label="Day">
        <Link
          className="m-day__btn"
          href={`/m?date=${prev}`}
          aria-label="Previous day"
          prefetch={false}
        >
          <Icon.ChevLeft />
        </Link>
        <div className="m-day__label">
          <b>{isToday ? 'Today' : formatLondonDayLong(day)}</b>
          {isToday ? (
            <span>{formatLondonDayLong(day)}</span>
          ) : (
            <Link href="/m" prefetch={false}>
              Back to today
            </Link>
          )}
        </div>
        <Link
          className="m-day__btn"
          href={`/m?date=${next}`}
          aria-label="Next day"
          prefetch={false}
        >
          <Icon.ChevRight />
        </Link>
      </nav>
      <Link
        className={`m-attn ${attention.bookings.length === 0 ? 'm-attn--calm' : ''}`}
        href="/m?view=attention"
        prefetch={false}
      >
        <Icon.Flag />
        {attention.bookings.length === 0 ? 'Nothing needs attention' : 'Needs attention'}
        <span className="m-attn__count">{attention.bookings.length}</span>
      </Link>
      <DayList bookings={dayView.bookings} drivers={dayView.drivers} mode="day" notice={notice} />
      {newButton}
    </>
  );
}
