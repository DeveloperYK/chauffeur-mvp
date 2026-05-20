import { CalendarGrid } from '@/components/calendar/calendar-grid';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PageContent, PageHeader } from '@/components/ui/page';
import {
  formatLondonMonth,
  formatLondonMonthLong,
  londonTodayString,
  parseDayString,
  parseMonthString,
} from '@/lib/dates';
import { env } from '@/lib/env';
import { getDb } from '@/server/db';
import { monthlyDayCounts } from '@/server/services/bookings-query';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function CalendarPage({
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

  const counts = await monthlyDayCounts(db, visibleMonth);
  let totalThisMonth = 0;
  let unassignedThisMonth = 0;
  for (const c of counts.values()) {
    totalThisMonth += c.total;
    unassignedThisMonth += c.unassigned;
  }

  return (
    <PageContent>
      <PageHeader
        title="Calendar"
        breadcrumb={
          <Link href="/dashboard" className="hover:underline">
            Board
          </Link>
        }
        description={
          <span className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-ink-muted">{formatLondonMonthLong(visibleMonth)}</span>
            <span className="text-ink-muted">·</span>
            <span>
              <span className="font-semibold text-ink">{totalThisMonth}</span>{' '}
              <span className="text-ink-muted">bookings this month</span>
            </span>
            {unassignedThisMonth > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-warning-100 px-2 py-0.5 text-xs font-medium text-warning-900">
                <span
                  aria-hidden
                  className="inline-block h-1.5 w-1.5 rounded-full bg-warning-500"
                />
                {unassignedThisMonth} unassigned
              </span>
            ) : null}
          </span>
        }
        actions={
          <Link href={`/dashboard?date=${selectedDay}&calMonth=${visibleMonth}`}>
            <Button variant="primary">Open board for selected day →</Button>
          </Link>
        }
      />

      <Card padded={false}>
        <div className="p-4">
          <CalendarGrid
            selectedDay={selectedDay}
            visibleMonth={visibleMonth}
            counts={counts}
            variant="expanded"
            dayHref="/dashboard"
            navHref="/dashboard/calendar"
          />
        </div>
      </Card>
    </PageContent>
  );
}
