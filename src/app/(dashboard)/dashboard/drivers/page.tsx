import { Avatar } from '@/components/console/avatar';
import { Icon } from '@/components/console/icons';
import { Lozenge } from '@/components/console/lozenge';
import { formatLondonDay, londonDayRangeUtc, londonTodayString, parseDayString } from '@/lib/dates';
import { env } from '@/lib/env';
import { VEHICLE_CLASS_LABEL, carDescription } from '@/lib/labels';
import { getDb } from '@/server/db';
import type { Booking, Driver, VehicleClass } from '@/server/db/schema';
import { listBookingsBetween } from '@/server/services/bookings-query';
import { listAllDrivers } from '@/server/services/drivers';
import Link from 'next/link';
import { deactivateDriverAction, reactivateDriverAction } from './actions';

export const dynamic = 'force-dynamic';

/** The four driver vehicle classes, in display order. */
const VEHICLE_CLASSES: VehicleClass[] = ['executive', 'luxury', 'mpv', 'coach'];

const SCHEDULE_START_HOUR = 6;
const SCHEDULE_END_HOUR = 23;
const WEEKDAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const STATE_TONE_SCHED: Record<string, string> = {
  assigned: 'blue',
  in_progress: 'yellow',
  awaiting_driver_form: 'orange',
  awaiting_operator_review: 'purple',
  completed: 'green',
};

function fmtTime(d: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

function addDays(dayStr: string, n: number): string {
  const d = new Date(`${dayStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return formatLondonDay(d);
}

/** Monday-of-week day string (London) for the week containing `dayStr`. */
function weekMonday(dayStr: string): string {
  const d = new Date(`${dayStr}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // 0 = Monday
  return addDays(dayStr, -dow);
}

export default async function DriversPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    vc?: string;
    q?: string;
    mode?: string;
    schedDate?: string;
  }>;
}) {
  const url = env().DATABASE_URL;
  if (!url) return <div className="content">DATABASE_URL not configured.</div>;
  const { db } = getDb(url);
  const params = await searchParams;

  const view = params.view === 'schedule' ? 'schedule' : 'roster';
  const vc = (VEHICLE_CLASSES as string[]).includes(params.vc ?? '')
    ? (params.vc as string)
    : 'all';
  const q = (params.q ?? '').trim().toLowerCase();
  const mode = params.mode === 'week' ? 'week' : 'day';
  const today = londonTodayString();
  const schedDate = params.schedDate && parseDayString(params.schedDate) ? params.schedDate : today;

  const allDrivers = await listAllDrivers(db);

  // This week's bookings (for roster load bars + active-job counts).
  const weekStartDay = weekMonday(today);
  const weekStartUtc = londonDayRangeUtc(weekStartDay)?.startUtc ?? new Date();
  const weekEndUtc = londonDayRangeUtc(addDays(weekStartDay, 6))?.endUtc ?? new Date();
  const weekBookings = await listBookingsBetween(db, weekStartUtc, weekEndUtc);
  const jobsThisWeek = (drvId: string) =>
    weekBookings.filter((b) => b.assignedDriverId === drvId && b.state !== 'cancelled').length;
  const activeJobs = (drvId: string) =>
    weekBookings.filter(
      (b) => b.assignedDriverId === drvId && !['completed', 'cancelled'].includes(b.state),
    ).length;

  const classOrder = (c: string) => (VEHICLE_CLASSES as string[]).indexOf(c);
  const visible = allDrivers
    .filter((d) => (vc === 'all' ? true : d.vehicleClass === vc))
    .filter((d) => !q || d.name.toLowerCase().includes(q))
    .sort((a, b) => {
      if (a.vehicleClass !== b.vehicleClass)
        return classOrder(a.vehicleClass) - classOrder(b.vehicleClass);
      return a.name.localeCompare(b.name);
    });

  const qs = (o: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const cur: Record<string, string | undefined> = {
      view: view === 'schedule' ? 'schedule' : undefined,
      vc: vc === 'all' ? undefined : vc,
      q: q || undefined,
      mode: mode === 'week' ? 'week' : undefined,
      schedDate: schedDate !== today ? schedDate : undefined,
    };
    for (const [k, v] of Object.entries({ ...cur, ...o })) if (v) p.set(k, v);
    const s = p.toString();
    return `/dashboard/drivers${s ? `?${s}` : ''}`;
  };

  return (
    <>
      <div className="page-head">
        <div className="page-head__row">
          <h1 className="page-head__title">Drivers</h1>
          <span className="page-head__sub dotsep-pre">
            <b className="tabnum">{allDrivers.filter((d) => d.active).length}</b> active ·{' '}
            <b className="tabnum">{allDrivers.length}</b> total
          </span>
          <span style={{ flex: 1 }} />
          <div className="viewswitch">
            <Link className={view === 'roster' ? 'is-active' : ''} href={qs({ view: null })}>
              <Icon.List /> Roster
            </Link>
            <Link
              className={view === 'schedule' ? 'is-active' : ''}
              href={qs({ view: 'schedule' })}
            >
              <Icon.Calendar /> Schedule
            </Link>
          </div>
          <Link className="btn btn--primary" href="/dashboard/drivers/new">
            <Icon.Plus /> Add driver
          </Link>
        </div>
      </div>

      <div className="content">
        {view === 'roster' ? (
          <>
            <div className="filterbar" style={{ padding: 0, marginBottom: 12 }}>
              <div className="viewswitch">
                <Link className={vc === 'all' ? 'is-active' : ''} href={qs({ vc: null })}>
                  All ({allDrivers.length})
                </Link>
                {VEHICLE_CLASSES.map((c) => (
                  <Link key={c} className={vc === c ? 'is-active' : ''} href={qs({ vc: c })}>
                    {VEHICLE_CLASS_LABEL[c]} (
                    {allDrivers.filter((d) => d.vehicleClass === c).length})
                  </Link>
                ))}
              </div>
            </div>
            <DriverRoster drivers={visible} jobsThisWeek={jobsThisWeek} activeJobs={activeJobs} />
          </>
        ) : (
          <Schedule
            db={db}
            drivers={visible}
            mode={mode}
            schedDate={schedDate}
            today={today}
            qs={qs}
          />
        )}
      </div>
    </>
  );
}

function DriverRoster({
  drivers,
  jobsThisWeek,
  activeJobs,
}: {
  drivers: Driver[];
  jobsThisWeek: (id: string) => number;
  activeJobs: (id: string) => number;
}) {
  if (drivers.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-4)' }}>
        No drivers match.
      </div>
    );
  }
  return (
    <div className="driver-table">
      <div className="dt-row dt-row--load head">
        <span>Name</span>
        <span>Type</span>
        <span>Car</span>
        <span>WhatsApp</span>
        <span>This week</span>
        <span style={{ textAlign: 'right' }}>Status</span>
      </div>
      {drivers.map((d) => {
        const week = jobsThisWeek(d.id);
        const loadPct = Math.min(100, Math.round((week / 15) * 100));
        const loadClass = loadPct > 80 ? 'high' : loadPct > 50 ? 'med' : '';
        const active = activeJobs(d.id);
        return (
          <div className="dt-row dt-row--load" key={d.id}>
            <span className="name">
              <Avatar name={d.name} id={d.id} size={26} />
              <span>
                {d.name}
                {active > 0 ? (
                  <span style={{ marginLeft: 8 }}>
                    <Lozenge tone="blue">{active} ACTIVE</Lozenge>
                  </span>
                ) : null}
              </span>
            </span>
            <span>
              <span className={`vc-tag ${d.vehicleClass}`}>
                {VEHICLE_CLASS_LABEL[d.vehicleClass]}
              </span>
            </span>
            <span>{carDescription(d.car, d.carColour)}</span>
            <span className="ws">{d.whatsappNumber}</span>
            <span className="load-cell">
              <span className="load-bar">
                <i style={{ width: `${loadPct}%` }} className={loadClass} />
              </span>
              <span className="tabnum">
                <strong>{week}</strong>
                <span className="muted">/15</span>
              </span>
            </span>
            <span
              style={{
                textAlign: 'right',
                display: 'flex',
                gap: 12,
                justifyContent: 'flex-end',
                alignItems: 'center',
              }}
            >
              {d.active ? (
                <Lozenge tone="green">ACTIVE</Lozenge>
              ) : (
                <Lozenge tone="gray">INACTIVE</Lozenge>
              )}
              <Link className="link-btn" href={`/dashboard/drivers/${d.id}/edit`}>
                Edit
              </Link>
              {d.active ? (
                <form action={deactivateDriverAction} className="contents">
                  <input type="hidden" name="id" value={d.id} />
                  <button type="submit" className="link-btn">
                    Deactivate
                  </button>
                </form>
              ) : (
                <form action={reactivateDriverAction} className="contents">
                  <input type="hidden" name="id" value={d.id} />
                  <button type="submit" className="link-btn">
                    Reactivate
                  </button>
                </form>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

async function Schedule({
  db,
  drivers,
  mode,
  schedDate,
  today,
  qs,
}: {
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle Database union type
  db: any;
  drivers: Driver[];
  mode: 'day' | 'week';
  schedDate: string;
  today: string;
  qs: (o: Record<string, string | null>) => string;
}) {
  const monday = weekMonday(schedDate);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const rangeStart =
    mode === 'day' ? londonDayRangeUtc(schedDate)?.startUtc : londonDayRangeUtc(monday)?.startUtc;
  const rangeEnd =
    mode === 'day'
      ? londonDayRangeUtc(schedDate)?.endUtc
      : londonDayRangeUtc(weekDays[6] as string)?.endUtc;
  const rows: Booking[] =
    rangeStart && rangeEnd ? await listBookingsBetween(db, rangeStart, rangeEnd) : [];

  const headLabel =
    mode === 'day'
      ? new Date(`${schedDate}T12:00:00Z`).toLocaleDateString('en-GB', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          timeZone: 'Europe/London',
        })
      : `${new Date(`${monday}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' })} – ${new Date(`${weekDays[6]}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' })}`;

  return (
    <div className="sched">
      <div className="sched__bar">
        <div className="viewswitch">
          <Link className={mode === 'day' ? 'is-active' : ''} href={qs({ mode: null })}>
            Day
          </Link>
          <Link className={mode === 'week' ? 'is-active' : ''} href={qs({ mode: 'week' })}>
            Week
          </Link>
        </div>
        <div className="sched__nav">
          <Link
            className="icon-btn"
            href={qs({ schedDate: addDays(schedDate, mode === 'day' ? -1 : -7) })}
          >
            <Icon.ChevLeft />
          </Link>
          <span className="sched__label">{headLabel}</span>
          <Link
            className="icon-btn"
            href={qs({ schedDate: addDays(schedDate, mode === 'day' ? 1 : 7) })}
          >
            <Icon.ChevRight />
          </Link>
        </div>
        <Link className="link-btn" href={qs({ schedDate: null })}>
          Jump to today
        </Link>
        <span style={{ flex: 1 }} />
      </div>

      {mode === 'day' ? (
        <ScheduleDay drivers={drivers} rows={rows} date={schedDate} today={today} />
      ) : (
        <ScheduleWeek drivers={drivers} rows={rows} weekDays={weekDays} today={today} />
      )}
    </div>
  );
}

function ScheduleDay({
  drivers,
  rows,
  date,
  today,
}: {
  drivers: Driver[];
  rows: Booking[];
  date: string;
  today: string;
}) {
  const hours: number[] = [];
  for (let h = SCHEDULE_START_HOUR; h <= SCHEDULE_END_HOUR; h++) hours.push(h);
  const totalHours = SCHEDULE_END_HOUR - SCHEDULE_START_HOUR;
  const londonHM = (d: Date) => {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(d);
    const hh = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
    const mm = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    return hh * 60 + mm;
  };
  const pctFromTime = (d: Date) =>
    Math.max(
      0,
      Math.min(100, ((londonHM(d) - SCHEDULE_START_HOUR * 60) / (totalHours * 60)) * 100),
    );
  const pctFromDuration = (mins: number) => Math.min(100, (mins / (totalHours * 60)) * 100);

  const byDriver = new Map<string, Booking[]>();
  for (const b of rows) {
    if (!b.assignedDriverId) continue;
    const arr = byDriver.get(b.assignedDriverId) ?? [];
    arr.push(b);
    byDriver.set(b.assignedDriverId, arr);
  }

  return (
    <div className="sched-day">
      <div className="sched-day__head">
        <div className="sched-day__driver-col">Driver</div>
        <div className="sched-day__hours">
          {hours.map((h) => (
            <div key={h} className="sched-day__hour-tick">
              <span>{String(h).padStart(2, '0')}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="sched-day__body">
        {drivers.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-4)' }}>
            No drivers match.
          </div>
        ) : null}
        {drivers.map((d) => {
          const mine = byDriver.get(d.id) ?? [];
          return (
            <div key={d.id} className="sched-day__row">
              <div className="sched-day__driver">
                <Avatar name={d.name} id={d.id} size={22} />
                <div>
                  <div className="sched-day__driver-name">{d.name}</div>
                  <div className="sched-day__driver-meta">
                    <span className={`vc-tag ${d.vehicleClass}`}>
                      {VEHICLE_CLASS_LABEL[d.vehicleClass]}
                    </span>
                  </div>
                </div>
              </div>
              <div className="sched-day__lane">
                {hours.slice(0, -1).map((h) => (
                  <div key={h} className="sched-day__gridline" />
                ))}
                {mine.map((b) => {
                  const tone = STATE_TONE_SCHED[b.state] ?? 'gray';
                  return (
                    <div
                      key={b.id}
                      className={`sched-block sched-block--${tone}`}
                      style={{
                        left: `${pctFromTime(b.pickupAt)}%`,
                        width: `${pctFromDuration(b.expectedDurationMinutes)}%`,
                      }}
                      title={`${b.passengerFirstName} ${b.passengerLastName} · ${fmtTime(b.pickupAt)} · ${b.expectedDurationMinutes} min`}
                    >
                      <div className="sched-block__time">{fmtTime(b.pickupAt)}</div>
                      <div className="sched-block__name">
                        {b.passengerFirstName} {b.passengerLastName}
                      </div>
                    </div>
                  );
                })}
                {mine.length === 0 ? <div className="sched-day__empty">Free all day</div> : null}
              </div>
            </div>
          );
        })}
      </div>
      {date === today ? null : null}
    </div>
  );
}

function ScheduleWeek({
  drivers,
  rows,
  weekDays,
  today,
}: {
  drivers: Driver[];
  rows: Booking[];
  weekDays: string[];
  today: string;
}) {
  const countFor = (drvId: string, day: string) =>
    rows.filter(
      (b) =>
        b.assignedDriverId === drvId &&
        formatLondonDay(b.pickupAt) === day &&
        b.state !== 'cancelled',
    ).length;

  return (
    <div className="sched-week">
      <div className="sched-week__head">
        <div className="sched-week__driver-col">Driver</div>
        {weekDays.map((day, i) => (
          <div key={day} className={`sched-week__day-head ${day === today ? 'is-today' : ''}`}>
            <div className="dow">{WEEKDAY[i]}</div>
            <div className="num">{Number(day.slice(8, 10))}</div>
          </div>
        ))}
        <div className="sched-week__total-head">Wk total</div>
      </div>
      <div className="sched-week__body">
        {drivers.map((d) => {
          const counts = weekDays.map((day) => countFor(d.id, day));
          const total = counts.reduce((a, c) => a + c, 0);
          const maxPerDay = Math.max(1, ...counts);
          return (
            <div key={d.id} className="sched-week__row">
              <div className="sched-day__driver">
                <Avatar name={d.name} id={d.id} size={22} />
                <div>
                  <div className="sched-day__driver-name">{d.name}</div>
                  <div className="sched-day__driver-meta">
                    <span className={`vc-tag ${d.vehicleClass}`}>
                      {VEHICLE_CLASS_LABEL[d.vehicleClass]}
                    </span>
                  </div>
                </div>
              </div>
              {counts.map((c, i) => (
                <div
                  key={weekDays[i]}
                  className={`sched-week__cell ${weekDays[i] === today ? 'is-today' : ''} ${c === 0 ? 'is-empty' : ''}`}
                >
                  {c > 0 ? (
                    <>
                      <div className="sched-week__cell-bar">
                        <i style={{ width: `${(c / maxPerDay) * 100}%` }} />
                      </div>
                      <span className="sched-week__cell-num tabnum">{c}</span>
                    </>
                  ) : (
                    <span className="muted" style={{ fontSize: 11 }}>
                      —
                    </span>
                  )}
                </div>
              ))}
              <div className="sched-week__total tabnum">
                <strong>{total}</strong>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
