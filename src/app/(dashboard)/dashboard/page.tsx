import { Avatar, UnassignedAvatar } from '@/components/console/avatar';
import { CalendarPopover } from '@/components/console/calendar-popover';
import { ConsoleBoard } from '@/components/console/console-board';
import { Icon } from '@/components/console/icons';
import { Lozenge } from '@/components/console/lozenge';
import type { ConsoleBooking, ConsoleDriver, ConsoleOperator } from '@/components/console/types';
import { actionViewById, isActionViewId } from '@/lib/action-views';
import {
  formatLondonDayLong,
  formatLondonMonth,
  londonTodayString,
  parseDayString,
  parseMonthString,
} from '@/lib/dates';
import { env } from '@/lib/env';
import { currentSession } from '@/server/auth/current';
import { getDb, resetDb } from '@/server/db';
import type { Booking } from '@/server/db/schema';
import { DB_TIMEOUT_MS, withDbTimeout } from '@/server/db/timeout';
import { sampleGeneratorEnabled } from '@/server/feature-flags';
import { listActionView } from '@/server/services/action-views';
import { listStopsForBookings } from '@/server/services/booking-stops';
import {
  type DayCounts,
  driverDispatchData,
  listBookingsForDay,
  monthlyDayCounts,
} from '@/server/services/bookings-query';
import { toConsoleBooking, toConsoleDriver } from '@/server/services/console-view';
import { listAllDrivers } from '@/server/services/drivers';
import { execEmailSendMap } from '@/server/services/exec-notifications';
import { openOffersForBookings } from '@/server/services/offers';
import { listOperators } from '@/server/services/operators';
import Link from 'next/link';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';
// Hard ceiling for the board render and the server actions posted to it. The
// client-side DB guard (DB_TIMEOUT_MS) fires well before this; this is the
// backstop so a hung instance never holds a request for Vercel's 300 s default.
export const maxDuration = 60;

const UNASSIGNED = 'unassigned';

export default async function DashboardHome({
  searchParams,
}: {
  searchParams: Promise<{
    date?: string;
    calMonth?: string;
    assignee?: string;
    q?: string;
    savedView?: string;
    layout?: string;
    showDone?: string;
    new?: string;
    booking?: string;
  }>;
}) {
  const session = await currentSession();
  if (!session) redirect('/login');

  const url = env().DATABASE_URL;
  if (!url) {
    return <div className="content">DATABASE_URL not configured.</div>;
  }
  const { db } = getDb(url);
  const params = await searchParams;
  const today = londonTodayString();
  const selectedDay = params.date && parseDayString(params.date) ? params.date : today;
  const visibleMonth =
    params.calMonth && parseMonthString(params.calMonth)
      ? params.calMonth
      : formatLondonMonth(new Date(`${selectedDay}T12:00:00Z`));
  const q = (params.q ?? '').trim();
  // Unknown ids (old bookmarks for retired views) fall back to the day board.
  const savedView = isActionViewId(params.savedView) ? params.savedView : null;
  // List is the default layout; board is opt-in via ?layout=board.
  const layout = params.layout === 'board' ? 'board' : 'list';
  // Done bookings show by default; the operator can hide them via ?showDone=0.
  const showDone = params.showDone !== '0';
  const selectedTokens = new Set(
    (params.assignee ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

  // A wedged connection pool would otherwise hang this render for minutes; on
  // the deadline the pool is torn down and the error boundary offers a retry.
  const [viewRows, countsMap, drivers, operatorList, dispatch] = await withDbTimeout(
    'board load',
    DB_TIMEOUT_MS.page,
    () =>
      Promise.all([
        savedView ? listActionView(db, savedView) : listBookingsForDay(db, selectedDay),
        monthlyDayCounts(db, visibleMonth),
        listAllDrivers(db),
        listOperators(db),
        driverDispatchData(db),
      ]),
    resetDb,
  );

  const counts: Record<string, DayCounts> = {};
  for (const [day, c] of countsMap.entries()) counts[day] = c;

  const operatorName = new Map(operatorList.map((o) => [o.id, o.name]));

  // Facepile from the view set (stable, pre-filter).
  const perOperator = new Map<string, number>();
  let unassignedCount = 0;
  for (const b of viewRows) {
    if (b.assignedOperatorId)
      perOperator.set(b.assignedOperatorId, (perOperator.get(b.assignedOperatorId) ?? 0) + 1);
    else unassignedCount += 1;
  }
  const facepile = [
    ...[...perOperator.entries()]
      .map(([id, count]) => ({
        token: id,
        name: operatorName.get(id) ?? 'Unknown',
        isUnassigned: false,
        count,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    ...(unassignedCount > 0
      ? [{ token: UNASSIGNED, name: undefined, isUnassigned: true, count: unassignedCount }]
      : []),
  ];

  // Search + assignee filters.
  const matchesQuery = (b: Booking) => {
    if (!q) return true;
    const needle = q.toLowerCase();
    return [
      b.id,
      b.passengerFirstName,
      b.passengerLastName ?? '',
      b.pickupAddress,
      b.dropoffAddress ?? '',
      b.accountCode ?? '',
      b.caseCode ?? '',
    ].some((x) => x.toLowerCase().includes(needle));
  };
  const matchesAssignee = (b: Booking) => {
    if (selectedTokens.size === 0) return true;
    return b.assignedOperatorId
      ? selectedTokens.has(b.assignedOperatorId)
      : selectedTokens.has(UNASSIGNED);
  };
  const filtered = viewRows.filter(matchesQuery).filter(matchesAssignee);

  const dayStats = {
    total: viewRows.length,
    unassigned: viewRows.filter((b) => b.state === 'unassigned').length,
    inProgress: viewRows.filter((b) => b.state === 'in_progress').length,
    needsAction: viewRows.filter((b) =>
      ['awaiting_driver_form', 'awaiting_operator_review'].includes(b.state),
    ).length,
  };

  const qs = (overrides: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const cur: Record<string, string | undefined> = {
      date: selectedDay,
      calMonth: visibleMonth,
      assignee: params.assignee,
      q: q || undefined,
      savedView: savedView ?? undefined,
      layout: layout === 'board' ? 'board' : undefined,
      showDone: showDone ? undefined : '0',
    };
    for (const [k, v] of Object.entries({ ...cur, ...overrides })) {
      if (v) p.set(k, v);
    }
    return `/dashboard?${p.toString()}`;
  };
  const toggleAssignee = (token: string) => {
    const next = new Set(selectedTokens);
    if (next.has(token)) next.delete(token);
    else next.add(token);
    return qs({ assignee: next.size ? [...next].join(',') : null });
  };

  const isToday = selectedDay === today;
  // Past days are history: the live workflow columns (unassigned/assigned/…) are
  // not useful, so the board collapses to a completed-bookings view. Saved views
  // span days, so they never count as "past".
  const isPast = !savedView && selectedDay < today;

  // Open dispatch offers for the unassigned bookings on screen, so each card can
  // show "Offered to N · awaiting". Only unassigned bookings can have open offers.
  const unassignedIds = filtered.filter((b) => b.state === 'unassigned').map((b) => b.id);
  // Which of the two operator emails each booking has had — drives the
  // "email not sent" flags on cards and in the panel.
  const [offersByBooking, emailSends, stopsByBooking] = await withDbTimeout(
    'board details',
    DB_TIMEOUT_MS.page,
    () =>
      Promise.all([
        openOffersForBookings(db, unassignedIds),
        execEmailSendMap(
          db,
          filtered.map((b) => b.id),
        ),
        listStopsForBookings(
          db,
          filtered.map((b) => b.id),
        ),
      ]),
    resetDb,
  );

  // Serialize for the client console shell.
  const consoleBookings: ConsoleBooking[] = filtered.map((b) =>
    toConsoleBooking(b, offersByBooking.get(b.id) ?? [], emailSends, stopsByBooking.get(b.id)),
  );
  const consoleDrivers: ConsoleDriver[] = drivers.map(toConsoleDriver);
  const consoleOperators: ConsoleOperator[] = operatorList.map((o) => ({ id: o.id, name: o.name }));

  return (
    <>
      {/* ── Page head ─────────────────────────────────────────── */}
      <div className="page-head">
        {savedView ? (
          <>
            <div className="page-head__row">
              <h1 className="page-head__title">{actionViewById(savedView).name}</h1>
              <span className="page-head__sub">
                {filtered.length} {filtered.length === 1 ? 'ticket' : 'tickets'}
              </span>
              <Link
                className="link-btn"
                href={qs({ savedView: null })}
                style={{ marginLeft: 6 }}
                prefetch={false}
              >
                ← Back to day view
              </Link>
            </div>
            <p className="page-head__desc">{actionViewById(savedView).subtitle}</p>
          </>
        ) : (
          <>
            <div className="page-head__row">
              <h1 className="page-head__title">Board</h1>
              <CalendarPopover
                selectedDay={selectedDay}
                visibleMonth={visibleMonth}
                counts={counts}
              />
              {isToday ? (
                <Lozenge tone="blue">TODAY</Lozenge>
              ) : (
                <Link
                  className="link-btn"
                  href={qs({ date: today, calMonth: today.slice(0, 7) })}
                  prefetch={false}
                >
                  ← Back to today
                </Link>
              )}
              <span className="page-head__sub dotsep-pre">{formatLondonDayLong(selectedDay)}</span>
              <span className="page-head__sub dotsep-pre">
                {filtered.length} {filtered.length === 1 ? 'booking' : 'bookings'}
              </span>
            </div>
            <div className="page-head__strip">
              <span>
                <span className="pip" style={{ background: 'var(--ink-3)' }} />
                <b>{dayStats.total}</b> booked today
              </span>
              <span>
                <span className="pip" style={{ background: 'var(--lz-yellow-fg)' }} />
                <b>{dayStats.unassigned}</b> unassigned
              </span>
              <span>
                <span className="pip" style={{ background: 'var(--lz-blue-fg)' }} />
                <b>{dayStats.inProgress}</b> in progress
              </span>
              <span className={dayStats.needsAction > 0 ? 'needs' : undefined}>
                <span
                  className="pip"
                  style={{
                    background:
                      dayStats.needsAction > 0 ? 'var(--lz-red-fg)' : 'var(--lz-green-fg)',
                  }}
                />
                <b>{dayStats.needsAction}</b> needs action
              </span>
            </div>
          </>
        )}
      </div>

      {/* ── Filter bar ────────────────────────────────────────── */}
      <div className="filterbar">
        {facepile.length > 0 ? (
          <div className="facepile-row">
            <span className="facepile-row__label">Assignee</span>
            <div className="facepile">
              {facepile.map((it) => (
                <Link
                  key={it.token}
                  className="facepile__btn"
                  href={toggleAssignee(it.token)}
                  prefetch={false}
                >
                  {it.isUnassigned ? (
                    <UnassignedAvatar size={28} selected={selectedTokens.has(it.token)} />
                  ) : (
                    <Avatar
                      name={it.name ?? '?'}
                      id={it.token}
                      size={28}
                      selected={selectedTokens.has(it.token)}
                    />
                  )}
                  <span className="facepile__count">{it.count}</span>
                </Link>
              ))}
            </div>
            {selectedTokens.size > 0 ? (
              <Link className="facepile-row__clear" href={qs({ assignee: null })} prefetch={false}>
                Clear
              </Link>
            ) : null}
          </div>
        ) : null}

        <span className="filterbar__spacer" />

        <Link
          className={`f-chip ${showDone ? 'has-value' : ''}`}
          href={qs({ showDone: showDone ? '0' : null })}
          prefetch={false}
        >
          <Icon.Check />
          {showDone ? 'Showing done' : 'Hide done'}
        </Link>

        <div className="viewswitch">
          <Link
            className={layout === 'board' ? 'is-active' : ''}
            href={qs({ layout: 'board' })}
            prefetch={false}
          >
            <Icon.Board /> Board
          </Link>
          <Link
            className={layout === 'list' ? 'is-active' : ''}
            href={qs({ layout: null })}
            prefetch={false}
          >
            <Icon.List /> List
          </Link>
        </div>
      </div>

      {/* ── Board + overlays (client) ─────────────────────────── */}
      <ConsoleBoard
        bookings={consoleBookings}
        drivers={consoleDrivers}
        operators={consoleOperators}
        assignments={dispatch.windows}
        me={{ id: session.operator.id, name: session.operator.name }}
        layout={layout}
        showDone={showDone}
        isPast={isPast}
        initialNewOpen={params.new === '1'}
        initialSelectedId={params.booking ?? null}
        showSampleGenerator={sampleGeneratorEnabled()}
      />
    </>
  );
}
