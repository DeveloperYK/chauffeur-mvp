import { Avatar, UnassignedAvatar } from '@/components/console/avatar';
import { CalendarPopover } from '@/components/console/calendar-popover';
import { ConsoleBoard } from '@/components/console/console-board';
import { Icon } from '@/components/console/icons';
import { Lozenge } from '@/components/console/lozenge';
import type { ConsoleBooking, ConsoleDriver, ConsoleOperator } from '@/components/console/types';
import {
  formatLondonDayLong,
  formatLondonMonth,
  londonTodayString,
  parseDayString,
  parseMonthString,
} from '@/lib/dates';
import { env } from '@/lib/env';
import { currentSession } from '@/server/auth/current';
import { getDb } from '@/server/db';
import type { Booking, BookingState } from '@/server/db/schema';
import {
  type DayCounts,
  driverDispatchData,
  listBookingsByState,
  listBookingsForDay,
  monthlyDayCounts,
} from '@/server/services/bookings-query';
import { listAllDrivers } from '@/server/services/drivers';
import { listOperators } from '@/server/services/operators';
import Link from 'next/link';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

const SAVED_VIEW_LABEL: Record<string, string> = {
  unassigned: 'Unassigned tickets',
  needs_review: 'Awaiting review',
};
const SAVED_VIEW_STATE: Record<string, BookingState> = {
  unassigned: 'unassigned',
  needs_review: 'awaiting_operator_review',
};

const UNASSIGNED = 'unassigned';

function toConsoleBooking(b: Booking): ConsoleBooking {
  return {
    id: b.id,
    state: b.state,
    pickupAt: b.pickupAt.toISOString(),
    expectedDurationMinutes: b.expectedDurationMinutes,
    pickupAddress: b.pickupAddress,
    dropoffAddress: b.dropoffAddress,
    passengerFirstName: b.passengerFirstName,
    passengerLastName: b.passengerLastName,
    execMobile: b.execMobile,
    clientName: b.clientName,
    accountCode: b.accountCode,
    contractPricePence: b.contractPricePence,
    notes: b.notes,
    createdByOperatorId: b.createdByOperatorId,
    assignedOperatorId: b.assignedOperatorId,
    assignedDriverId: b.assignedDriverId,
    carForThisJob: b.carForThisJob,
    carParkPence: b.carParkPence,
    waitingTimeMinutes: b.waitingTimeMinutes,
    dropoffAt: b.dropoffAt ? b.dropoffAt.toISOString() : null,
    cancelledAt: b.cancelledAt ? b.cancelledAt.toISOString() : null,
    cancellationReason: b.cancellationReason,
    flaggedAt: b.flaggedAt ? b.flaggedAt.toISOString() : null,
  };
}

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
  const savedView =
    params.savedView && SAVED_VIEW_STATE[params.savedView] ? params.savedView : null;
  const layout = params.layout === 'list' ? 'list' : 'board';
  const showDone = params.showDone === '1';
  const selectedTokens = new Set(
    (params.assignee ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

  const [viewRows, countsMap, drivers, operatorList, dispatch] = await Promise.all([
    savedView
      ? listBookingsByState(db, SAVED_VIEW_STATE[savedView] as BookingState)
      : listBookingsForDay(db, selectedDay),
    monthlyDayCounts(db, visibleMonth),
    listAllDrivers(db),
    listOperators(db),
    driverDispatchData(db),
  ]);

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
      b.dropoffAddress,
      b.clientName,
      b.accountCode,
      b.carForThisJob ?? '',
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
      layout: layout === 'list' ? 'list' : undefined,
      showDone: showDone ? '1' : undefined,
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

  // Serialize for the client console shell.
  const consoleBookings: ConsoleBooking[] = filtered.map(toConsoleBooking);
  const consoleDrivers: ConsoleDriver[] = drivers.map((d) => ({
    id: d.id,
    name: d.name,
    tier: d.tier,
    defaultCarType: d.defaultCarType,
    whatsappNumber: d.whatsappNumber,
    active: d.active,
    jobsThisWeek: dispatch.weekLoads[d.id] ?? 0,
  }));
  const consoleOperators: ConsoleOperator[] = operatorList.map((o) => ({ id: o.id, name: o.name }));

  return (
    <>
      {/* ── Page head ─────────────────────────────────────────── */}
      <div className="page-head">
        {savedView ? (
          <div className="page-head__row">
            <h1 className="page-head__title">{SAVED_VIEW_LABEL[savedView]}</h1>
            <span className="page-head__sub">
              {filtered.length} {filtered.length === 1 ? 'ticket' : 'tickets'}
            </span>
            <Link className="link-btn" href={qs({ savedView: null })} style={{ marginLeft: 6 }}>
              ← Back to day view
            </Link>
          </div>
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
                <Link className="link-btn" href={qs({ date: today, calMonth: today.slice(0, 7) })}>
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
                <Link key={it.token} className="facepile__btn" href={toggleAssignee(it.token)}>
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
              <Link className="facepile-row__clear" href={qs({ assignee: null })}>
                Clear
              </Link>
            ) : null}
          </div>
        ) : null}

        <span className="filterbar__spacer" />

        <Link
          className={`f-chip ${showDone ? 'has-value' : ''}`}
          href={qs({ showDone: showDone ? null : '1' })}
        >
          <Icon.Check />
          {showDone ? 'Showing done' : 'Hide done'}
        </Link>

        <div className="viewswitch">
          <Link className={layout === 'board' ? 'is-active' : ''} href={qs({ layout: null })}>
            <Icon.Board /> Board
          </Link>
          <Link className={layout === 'list' ? 'is-active' : ''} href={qs({ layout: 'list' })}>
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
        initialNewOpen={params.new === '1'}
      />
    </>
  );
}
