import { Avatar, UnassignedAvatar } from '@/components/console/avatar';
import { Icon } from '@/components/console/icons';
import { Lozenge, StateLozenge, Tag } from '@/components/console/lozenge';
import { env } from '@/lib/env';
import { TIER_LABEL, carLabel } from '@/lib/labels';
import { currentSession } from '@/server/auth/current';
import { getDb } from '@/server/db';
import { type BookingState, bookings } from '@/server/db/schema';
import { canCancel } from '@/server/domain/booking-state';
import { listActiveDrivers } from '@/server/services/drivers';
import { listOperators, operatorsById } from '@/server/services/operators';
import { eq } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  approveAction,
  assignOperatorAction,
  cancelAction,
  generateCompletionLinkAction,
  generateLinkAction,
  rejectAction,
} from './actions';
import { AssigneeSelect } from './assignee-select';

export const dynamic = 'force-dynamic';

function fmtDateTime(d: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

export default async function BookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ url?: string; wa?: string; error?: string }>;
}) {
  const { id } = await params;
  const search = await searchParams;
  const session = await currentSession();
  if (!session) notFound();
  const url = env().DATABASE_URL;
  if (!url) {
    return <div className="content">DATABASE_URL not configured.</div>;
  }
  const { db } = getDb(url);
  const [booking] = await db.select().from(bookings).where(eq(bookings.id, id)).limit(1);
  if (!booking) notFound();

  const driverList = await listActiveDrivers(db);
  const operatorList = await listOperators(db);
  const driver = booking.assignedDriverId
    ? (driverList.find((d) => d.id === booking.assignedDriverId) ?? null)
    : null;
  const opLookup = await operatorsById(
    db,
    [booking.createdByOperatorId, booking.assignedOperatorId].filter((x): x is string =>
      Boolean(x),
    ),
  );
  const createdByName = booking.createdByOperatorId
    ? (opLookup.get(booking.createdByOperatorId)?.name ?? '—')
    : '—';
  const assignedName = booking.assignedOperatorId
    ? (opLookup.get(booking.assignedOperatorId)?.name ?? null)
    : null;
  const isAssignedToMe = booking.assignedOperatorId === session.operator.id;
  const vehicle = booking.carForThisJob;

  return (
    <div className="content" style={{ maxWidth: 760 }}>
      <span className="panel__crumb" style={{ marginBottom: 12 }}>
        <Link href="/dashboard" className="link-btn">
          Board
        </Link>
        <Icon.ChevRight className="chev" style={{ width: 11, height: 11 }} />
        <span className="mono">{booking.id.slice(0, 8)}</span>
      </span>

      {/* Hero */}
      <div className="dp-hero">
        <div className="dp-hero__lozenges">
          <StateLozenge state={booking.state} lg />
          {booking.flaggedAt ? (
            <Lozenge tone="red">
              <Icon.Flag style={{ width: 10, height: 10, marginRight: 4 }} />
              24H NO ACCEPT
            </Lozenge>
          ) : null}
        </div>
        <div className="dp-hero__eyebrow">Client</div>
        <h1 className="dp-hero__title">{booking.clientName}</h1>
        <div className="dp-hero__sub">
          {booking.passengerFirstName}
          {booking.passengerLastName ? ` ${booking.passengerLastName}` : ''}
        </div>
        <div className="dp-hero__stats">
          <div className="dp-stat">
            <div className="dp-stat__lbl">Pickup</div>
            <div className="dp-stat__val">{fmtDateTime(booking.pickupAt)}</div>
          </div>
          <div className="dp-stat">
            <div className="dp-stat__lbl">Duration</div>
            <div className="dp-stat__val">{booking.expectedDurationMinutes} min</div>
          </div>
          <div className="dp-stat dp-stat--price">
            <div className="dp-stat__lbl">Price</div>
            <div className="dp-stat__val tabnum">
              £{(booking.contractPricePence / 100).toFixed(2)}
            </div>
          </div>
        </div>
      </div>

      {search.error ? (
        <div className="ic ic--danger" style={{ marginTop: 12 }}>
          <div className="ic__body">{decodeURIComponent(search.error)}</div>
        </div>
      ) : null}

      {/* Review action strip */}
      {booking.state === 'awaiting_operator_review' ? (
        <div className="dp-actions">
          <form action={approveAction}>
            <input type="hidden" name="bookingId" value={booking.id} />
            <button className="btn btn--success btn--lg" type="submit">
              <Icon.Check /> Approve &amp; complete
            </button>
          </form>
          <form action={rejectAction}>
            <input type="hidden" name="bookingId" value={booking.id} />
            <button className="btn btn--danger" type="submit">
              Reject — driver to resubmit
            </button>
          </form>
        </div>
      ) : null}

      {/* Trip */}
      <section className="ic">
        <header className="ic__head">
          <span>Trip</span>
        </header>
        <div className="ic__body">
          <div className="route">
            <div className="route__pins">
              <span className="route__pin" />
              <span className="route__line" />
              <span className="route__pin route__pin--to" />
            </div>
            <div className="route__cells">
              <div className="route__cell">
                <div className="route__lbl">Pickup</div>
                <div className="route__addr">{booking.pickupAddress}</div>
              </div>
              <div className="route__cell">
                <div className="route__lbl">Drop-off</div>
                <div className="route__addr">{booking.dropoffAddress}</div>
              </div>
            </div>
          </div>
          {vehicle ? (
            <div className="trip-meta">
              <Tag>{carLabel(vehicle)}</Tag>
            </div>
          ) : null}
        </div>
      </section>

      {/* People */}
      <section className="ic">
        <header className="ic__head">
          <span>People</span>
        </header>
        <div className="ic__body">
          <div className="ir">
            <div className="ir__k">Client</div>
            <div className="ir__v">
              <div className="ir__main">{booking.clientName}</div>
              <div className="ir__sub mono">{booking.accountCode}</div>
            </div>
          </div>
          <div className="ir">
            <div className="ir__k">Passenger</div>
            <div className="ir__v">
              <div className="ir__main">
                {booking.passengerFirstName}
                {booking.passengerLastName ? ` ${booking.passengerLastName}` : ''}
              </div>
              <div className="ir__sub mono">{booking.execMobile}</div>
            </div>
          </div>
          <div className="ir">
            <div className="ir__k">Booked by</div>
            <div className="ir__v">
              <div className="ir__row">
                {booking.createdByOperatorId ? (
                  <Avatar name={createdByName} id={booking.createdByOperatorId} size={22} />
                ) : (
                  <UnassignedAvatar size={22} />
                )}
                <span>{createdByName}</span>
              </div>
            </div>
          </div>
          <div className="ir">
            <div className="ir__k">Operator</div>
            <div className="ir__v">
              <div className="ir__row">
                {assignedName ? (
                  <Avatar
                    name={assignedName}
                    id={booking.assignedOperatorId ?? assignedName}
                    size={22}
                  />
                ) : (
                  <UnassignedAvatar size={22} />
                )}
                <span className={assignedName ? undefined : 'muted'}>
                  {assignedName ?? 'Unassigned'}
                </span>
                {!isAssignedToMe ? (
                  <form action={assignOperatorAction} className="contents">
                    <input type="hidden" name="bookingId" value={booking.id} />
                    <input type="hidden" name="operatorId" value={session.operator.id} />
                    <button type="submit" className="link-btn">
                      Assign to me
                    </button>
                  </form>
                ) : null}
              </div>
              <div style={{ marginTop: 6 }}>
                <AssigneeSelect
                  action={assignOperatorAction}
                  bookingId={booking.id}
                  operators={operatorList}
                  currentOperatorId={booking.assignedOperatorId}
                />
              </div>
            </div>
          </div>
          <div className="ir">
            <div className="ir__k">Driver</div>
            <div className="ir__v">
              {driver ? (
                <div className="ir__row">
                  <Avatar name={driver.name} id={driver.id} size={22} />
                  <span>{driver.name}</span>
                  <span className={`tier-tag ${driver.tier}`}>{driver.tier}</span>
                  <span className="ir__sub mono" style={{ marginLeft: 4 }}>
                    {driver.whatsappNumber}
                  </span>
                </div>
              ) : (
                <span className="muted">Not yet assigned</span>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Notes */}
      {booking.notes ? (
        <section className="ic">
          <header className="ic__head">
            <span>Notes for the driver</span>
          </header>
          <div className="ic__body ic__body--prose">{booking.notes}</div>
        </section>
      ) : null}

      {/* Dispatch (unassigned) */}
      {booking.state === 'unassigned' ? (
        <section className="ic">
          <header className="ic__head">
            <span>Dispatch</span>
          </header>
          <div className="ic__body">
            {search.url ? (
              <div style={{ display: 'grid', gap: 10 }}>
                <div className="ir">
                  <div className="ir__k">Driver link</div>
                  <div className="ir__v">
                    <a
                      href={decodeURIComponent(search.url)}
                      className="mono"
                      style={{ wordBreak: 'break-all' }}
                    >
                      {decodeURIComponent(search.url)}
                    </a>
                  </div>
                </div>
                {search.wa ? (
                  <a
                    className="btn btn--success"
                    href={decodeURIComponent(search.wa)}
                    rel="noopener noreferrer"
                    target="_blank"
                    style={{ width: 'fit-content' }}
                  >
                    Send via WhatsApp →
                  </a>
                ) : null}
              </div>
            ) : (
              <form
                action={generateLinkAction}
                style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
              >
                <input type="hidden" name="bookingId" value={booking.id} />
                <select
                  name="driverId"
                  required
                  defaultValue=""
                  className="input"
                  style={{ flex: 1, minWidth: 220 }}
                >
                  <option value="" disabled>
                    Choose a driver…
                  </option>
                  {driverList.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.tier === 'premium' ? '★ ' : ''}
                      {d.name} · {TIER_LABEL[d.tier]} · {carLabel(d.defaultCarType)}
                    </option>
                  ))}
                </select>
                <button className="btn btn--primary" type="submit">
                  <Icon.Plus /> Generate link
                </button>
              </form>
            )}
          </div>
        </section>
      ) : null}

      {/* Completion link (awaiting driver form) */}
      {booking.state === 'awaiting_driver_form' ? (
        <section className="ic">
          <header className="ic__head">
            <span>Awaiting driver completion form</span>
          </header>
          <div className="ic__body">
            {search.url ? (
              <div style={{ display: 'grid', gap: 10 }}>
                <a
                  href={decodeURIComponent(search.url)}
                  className="mono"
                  style={{ wordBreak: 'break-all' }}
                >
                  {decodeURIComponent(search.url)}
                </a>
                {search.wa ? (
                  <a
                    className="btn btn--success"
                    href={decodeURIComponent(search.wa)}
                    rel="noopener noreferrer"
                    target="_blank"
                    style={{ width: 'fit-content' }}
                  >
                    Send via WhatsApp →
                  </a>
                ) : null}
              </div>
            ) : (
              <form action={generateCompletionLinkAction}>
                <input type="hidden" name="bookingId" value={booking.id} />
                <button className="btn btn--primary" type="submit">
                  <Icon.Plus /> Generate completion link
                </button>
              </form>
            )}
          </div>
        </section>
      ) : null}

      {/* Completion form (review / completed) */}
      {['awaiting_operator_review', 'completed'].includes(booking.state) ? (
        <section className="ic">
          <header className="ic__head">
            <span>Driver completion form</span>
          </header>
          <div className="ic__body">
            <div className="ir">
              <div className="ir__k">Car park</div>
              <div className="ir__v">
                {booking.carParkPence && booking.carParkPence > 0 ? (
                  `£${(booking.carParkPence / 100).toFixed(2)}`
                ) : (
                  <span className="muted">No car park fee</span>
                )}
              </div>
            </div>
            <div className="ir">
              <div className="ir__k">Waiting time</div>
              <div className="ir__v">{booking.waitingTimeMinutes ?? 0} min</div>
            </div>
            <div className="ir">
              <div className="ir__k">Drop-off</div>
              <div className="ir__v">
                {booking.dropoffAt ? fmtDateTime(booking.dropoffAt) : '—'}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {/* Cancellation */}
      {booking.state === 'cancelled' ? (
        <section className="ic ic--danger">
          <header className="ic__head">
            <span>Cancellation</span>
          </header>
          <div className="ic__body">
            <div className="ir">
              <div className="ir__k">When</div>
              <div className="ir__v">
                {booking.cancelledAt ? fmtDateTime(booking.cancelledAt) : '—'}
              </div>
            </div>
            <div className="ir">
              <div className="ir__k">Reason</div>
              <div className="ir__v">{booking.cancellationReason ?? '—'}</div>
            </div>
          </div>
        </section>
      ) : null}

      {/* Cancel reveal */}
      {canCancel(booking.state as BookingState) ? (
        <details className="dp-cancel">
          <summary className="link-btn" style={{ color: 'var(--lz-red-fg)' }}>
            Cancel this booking
          </summary>
          <form action={cancelAction} className="ic ic--danger" style={{ marginTop: 10 }}>
            <div className="ic__body">
              <input type="hidden" name="bookingId" value={booking.id} />
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  color: 'var(--ink-3)',
                  marginBottom: 6,
                }}
              >
                Reason for cancellation
              </div>
              <textarea
                className="input"
                name="reason"
                required
                minLength={5}
                maxLength={1000}
                rows={3}
                placeholder="e.g. Client cancelled the trip. Booker confirmed by phone at 14:05."
                style={{ width: '100%', resize: 'vertical' }}
              />
              <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
                <button className="btn btn--danger" type="submit">
                  Cancel booking
                </button>
              </div>
            </div>
          </form>
        </details>
      ) : null}
    </div>
  );
}
