import { Avatar, UnassignedAvatar } from '@/components/console/avatar';
import { CalendarPopover } from '@/components/console/calendar-popover';
import { Icon } from '@/components/console/icons';
import { COL_LABEL, Lozenge, StateLozenge, Tag } from '@/components/console/lozenge';
import {
  formatLondonDayLong,
  formatLondonMonth,
  londonTodayString,
  parseDayString,
  parseMonthString,
} from '@/lib/dates';
import { env } from '@/lib/env';
import { getDb } from '@/server/db';
import type { Booking, BookingState, Driver } from '@/server/db/schema';
import {
  type DayCounts,
  groupByState,
  listBookingsByState,
  listBookingsForDay,
  monthlyDayCounts,
} from '@/server/services/bookings-query';
import { listAllDrivers } from '@/server/services/drivers';
import { type OperatorSummary, operatorsById } from '@/server/services/operators';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const STATE_ORDER: BookingState[] = [
  'unassigned',
  'assigned',
  'in_progress',
  'awaiting_driver_form',
  'awaiting_operator_review',
  'completed',
  'cancelled',
];

const SAVED_VIEW_LABEL: Record<string, string> = {
  unassigned: 'Unassigned tickets',
  needs_review: 'Awaiting review',
};
const SAVED_VIEW_STATE: Record<string, BookingState> = {
  unassigned: 'unassigned',
  needs_review: 'awaiting_operator_review',
};

const UNASSIGNED = 'unassigned';

function fmtTime(d: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

function truncate(s: string, n: number): string {
  return s && s.length > n ? `${s.slice(0, n - 1)}…` : s;
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
  }>;
}) {
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

  // The view set: a saved view filters by state across all days; otherwise the
  // selected day's bookings.
  const [viewRows, countsMap, drivers] = await Promise.all([
    savedView
      ? listBookingsByState(db, SAVED_VIEW_STATE[savedView] as BookingState)
      : listBookingsForDay(db, selectedDay),
    monthlyDayCounts(db, visibleMonth),
    listAllDrivers(db),
  ]);

  const counts: Record<string, DayCounts> = {};
  for (const [day, c] of countsMap.entries()) counts[day] = c;

  // Operator lookup for facepile + avatars.
  const opIds = viewRows.map((b) => b.assignedOperatorId).filter((x): x is string => Boolean(x));
  const operators = await operatorsById(db, opIds);

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
        name: operators.get(id)?.name ?? 'Unknown',
        isUnassigned: false,
        count,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    ...(unassignedCount > 0
      ? [{ token: UNASSIGNED, name: undefined, isUnassigned: true, count: unassignedCount }]
      : []),
  ];

  // Apply search + assignee filters.
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
  const board = groupByState(filtered);

  // Day stats (day mode only).
  const dayStats = {
    total: viewRows.length,
    unassigned: viewRows.filter((b) => b.state === 'unassigned').length,
    inProgress: viewRows.filter((b) => b.state === 'in_progress').length,
    needsAction: viewRows.filter((b) =>
      ['awaiting_driver_form', 'awaiting_operator_review'].includes(b.state),
    ).length,
  };

  // Querystring builder preserving current params.
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
  const cols = showDone
    ? STATE_ORDER
    : STATE_ORDER.filter((s) => !['completed', 'cancelled'].includes(s));

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

      {/* ── Content ───────────────────────────────────────────── */}
      <div className="content">
        {layout === 'board' ? (
          <div className="board">
            {cols.map((state) => (
              <Column key={state} state={state} bookings={board[state]} operators={operators} />
            ))}
          </div>
        ) : (
          <ListView
            bookings={filtered}
            drivers={drivers}
            operators={operators}
            showDone={showDone}
          />
        )}
      </div>
    </>
  );
}

// ── Board column + card ──────────────────────────────────────

function Column({
  state,
  bookings,
  operators,
}: {
  state: BookingState;
  bookings: Booking[];
  operators: Map<string, OperatorSummary>;
}) {
  return (
    <section className="column" aria-label={COL_LABEL[state]}>
      <header className="column__head">
        <span className="column__title">{COL_LABEL[state]}</span>
        <span className="column__count">{bookings.length}</span>
        {state === 'unassigned' ? (
          <Link className="column__add" href="/dashboard/new" title="Create booking">
            <Icon.Plus />
          </Link>
        ) : null}
      </header>
      <div className="column__body">
        {bookings.length === 0 ? (
          <div className="column__empty">No tickets.</div>
        ) : (
          bookings.map((b) => <BookingCard key={b.id} booking={b} operators={operators} />)
        )}
      </div>
    </section>
  );
}

function BookingCard({
  booking,
  operators,
}: {
  booking: Booking;
  operators: Map<string, OperatorSummary>;
}) {
  const assignee = booking.assignedOperatorId ? operators.get(booking.assignedOperatorId) : null;
  const vehicle = booking.carForThisJob;
  return (
    <Link
      href={`/dashboard/bookings/${booking.id}`}
      className={`card ${booking.flaggedAt ? 'is-flagged' : ''}`}
    >
      <div className="card__head">
        <span className="card__id mono">{booking.id.slice(0, 8)}</span>
        {booking.flaggedAt ? (
          <Icon.Flag
            style={{ color: 'var(--prio-high)', flex: '0 0 auto', width: 11, height: 11 }}
          />
        ) : null}
        <span className="card__time">{fmtTime(booking.pickupAt)}</span>
      </div>
      <div className="card__title">{booking.clientName}</div>
      <div className="card__sub">
        {booking.passengerFirstName}
        {booking.passengerLastName ? ` ${booking.passengerLastName}` : ''}
      </div>
      <div className="card__route">
        <span className="pin" />
        <span className="addr">{truncate(booking.pickupAddress, 44)}</span>
        <span className="pin to" />
        <span className="addr">{truncate(booking.dropoffAddress, 44)}</span>
      </div>
      <div className="card__meta">
        {vehicle ? <Tag>{vehicle}</Tag> : <span className="tag">No vehicle yet</span>}
        <span className="card__meta-right">
          {assignee ? (
            <Avatar
              name={assignee.name}
              id={assignee.id}
              size={20}
              title={`Assigned to ${assignee.name}`}
            />
          ) : (
            <UnassignedAvatar size={20} />
          )}
        </span>
      </div>
    </Link>
  );
}

// ── List view ────────────────────────────────────────────────

function ListView({
  bookings,
  drivers,
  operators,
  showDone,
}: {
  bookings: Booking[];
  drivers: Driver[];
  operators: Map<string, OperatorSummary>;
  showDone: boolean;
}) {
  const visible = bookings
    .filter((b) => showDone || !['completed', 'cancelled'].includes(b.state))
    .sort((a, b) => a.pickupAt.getTime() - b.pickupAt.getTime());
  return (
    <div className="list">
      <div className="list__row head">
        <span />
        <span>Pickup</span>
        <span>Client</span>
        <span>Route</span>
        <span>Driver</span>
        <span>Status</span>
        <span>Assignee</span>
        <span style={{ textAlign: 'right' }}>Price</span>
      </div>
      {visible.map((b) => {
        const driver = b.assignedDriverId ? drivers.find((d) => d.id === b.assignedDriverId) : null;
        const assignee = b.assignedOperatorId ? operators.get(b.assignedOperatorId) : null;
        return (
          <Link key={b.id} href={`/dashboard/bookings/${b.id}`} className="list__row">
            <span>
              {b.flaggedAt ? (
                <Icon.Flag style={{ color: 'var(--prio-high)', width: 12, height: 12 }} />
              ) : (
                <span style={{ width: 12, display: 'inline-block' }} />
              )}
            </span>
            <span className="time">{fmtTime(b.pickupAt)}</span>
            <span className="pax">
              {b.clientName}
              <div className="pax__sub">
                {b.passengerFirstName}
                {b.passengerLastName ? ` ${b.passengerLastName}` : ''} · {b.accountCode}
              </div>
            </span>
            <span className="route">
              {truncate(b.pickupAddress, 28)} → {truncate(b.dropoffAddress, 28)}
            </span>
            <span className="driver-cell">
              {driver ? (
                <>
                  <Avatar name={driver.name} id={driver.id} size={20} />
                  {driver.name}
                </>
              ) : (
                <span style={{ color: 'var(--ink-4)' }}>—</span>
              )}
            </span>
            <span>
              <StateLozenge state={b.state} />
            </span>
            <span>
              {assignee ? (
                <Avatar name={assignee.name} id={assignee.id} size={22} title={assignee.name} />
              ) : (
                <UnassignedAvatar size={22} />
              )}
            </span>
            <span className="price-cell">£{(b.contractPricePence / 100).toFixed(0)}</span>
          </Link>
        );
      })}
      {visible.length === 0 ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--ink-4)' }}>
          No bookings match this view.
        </div>
      ) : null}
    </div>
  );
}
