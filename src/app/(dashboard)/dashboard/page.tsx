import { CalendarPopover } from '@/components/calendar-popover';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageContent, PageHeader } from '@/components/ui/page';
import {
  formatLondonDayLong,
  formatLondonMonth,
  londonTodayString,
  parseDayString,
  parseMonthString,
} from '@/lib/dates';
import { env } from '@/lib/env';
import { STATE_BADGE, STATE_LABEL, carLabel } from '@/lib/labels';
import { getDb } from '@/server/db';
import type { Booking, BookingState } from '@/server/db/schema';
import {
  groupByState,
  listBookingsForDay,
  monthlyDayCounts,
} from '@/server/services/bookings-query';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const COLUMNS: BookingState[] = [
  'unassigned',
  'assigned',
  'in_progress',
  'awaiting_driver_form',
  'awaiting_operator_review',
  'completed',
  'cancelled',
];

export default async function DashboardHome({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; calMonth?: string }>;
}) {
  const url = env().DATABASE_URL;
  if (!url) {
    return (
      <PageContent>
        <p className="text-danger-700">DATABASE_URL not configured.</p>
      </PageContent>
    );
  }
  const { db } = getDb(url);
  const params = await searchParams;
  const today = londonTodayString();
  const selectedDay = params.date && parseDayString(params.date) ? params.date : today;
  const visibleMonth =
    params.calMonth && parseMonthString(params.calMonth)
      ? params.calMonth
      : formatLondonMonth(new Date(`${selectedDay}T12:00:00Z`));

  const [rows, counts] = await Promise.all([
    listBookingsForDay(db, selectedDay),
    monthlyDayCounts(db, visibleMonth),
  ]);
  const board = groupByState(rows);
  const total = rows.length;

  return (
    <PageContent>
      <PageHeader
        title="Dispatch board"
        description={
          <span className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-ink-muted">Showing</span>
            <span className="font-medium text-ink">{formatLondonDayLong(selectedDay)}</span>
            {selectedDay === today ? (
              <Badge className="bg-brand-50 text-brand-700">Today</Badge>
            ) : (
              <Link
                href={`/dashboard?date=${today}&calMonth=${today.slice(0, 7)}`}
                className="text-xs text-brand-700 hover:underline"
              >
                ← Back to today
              </Link>
            )}
            <span className="text-ink-muted">·</span>
            <span className="text-ink-muted">
              {total} {total === 1 ? 'booking' : 'bookings'}
            </span>
          </span>
        }
        actions={
          <div className="flex items-center gap-2">
            <CalendarPopover
              selectedDay={selectedDay}
              visibleMonth={visibleMonth}
              counts={counts}
            />
            <Link href="/dashboard/new">
              <Button variant="primary">+ New booking</Button>
            </Link>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7">
        {COLUMNS.map((state) => {
          const items = board[state];
          return (
            <section
              key={state}
              aria-label={STATE_LABEL[state]}
              className="rounded-md border border-border bg-surface-sunken/60 p-2"
            >
              <header className="mb-2 flex items-center justify-between px-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                  {STATE_LABEL[state]}
                </span>
                <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs font-semibold text-ink-subtle">
                  {items.length}
                </span>
              </header>
              <ul className="flex flex-col gap-2">
                {items.length === 0 ? (
                  <li className="px-1 py-2 text-xs italic text-ink-muted">No tickets.</li>
                ) : (
                  items.map((b) => <BookingCard key={b.id} booking={b} />)
                )}
              </ul>
            </section>
          );
        })}
      </div>
    </PageContent>
  );
}

function BookingCard({ booking }: { booking: Booking }) {
  return (
    <li>
      <Link
        href={`/dashboard/bookings/${booking.id}`}
        className="block rounded-md border border-border bg-surface p-2.5 shadow-card transition-shadow hover:shadow-card-hover"
      >
        <div className="mb-1 flex items-start justify-between gap-2">
          <span className="truncate text-sm font-semibold text-ink">
            {booking.passengerFirstName} {booking.passengerLastName}
          </span>
          <Badge size="sm" className={STATE_BADGE[booking.state]}>
            {STATE_LABEL[booking.state]}
          </Badge>
        </div>
        <p className="font-mono text-xs text-ink-muted">
          {booking.pickupAt.toISOString().replace('T', ' ').slice(0, 16)} UTC
        </p>
        <p className="mt-1 truncate text-xs text-ink-muted">
          {booking.pickupAddress} → {booking.dropoffAddress}
        </p>
        <p className="mt-1 text-xs text-ink-muted">
          <span className="font-medium text-ink-subtle">{booking.accountCode}</span> ·{' '}
          {carLabel(booking.carForThisJob ?? booking.carTypePreference)} · £
          {(booking.contractPricePence / 100).toFixed(2)}
          {booking.flaggedAt ? (
            <span className="ml-2 rounded bg-warning-100 px-1.5 py-0.5 text-2xs font-semibold uppercase text-warning-700">
              Flagged
            </span>
          ) : null}
        </p>
      </Link>
    </li>
  );
}
