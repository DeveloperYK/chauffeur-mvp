import '@/app/console.css';
import { Avatar } from '@/components/console/avatar';
import { Icon } from '@/components/console/icons';
import { Lozenge } from '@/components/console/lozenge';
import { driverJobCalendarUrl } from '@/lib/calendar';
import { carDescription } from '@/lib/labels';
import { appUrl, db, driverLinkSecret } from '@/server/composition';
import {
  bookings as bookingsTable,
  consumedTokens,
  drivers as driversTable,
} from '@/server/db/schema';
import { verifyDriverLink } from '@/server/domain/link-tokens';
import { previewChangeConfirmLink } from '@/server/services/change-confirmation';
import { previewDispatchLink, previewDriverJob } from '@/server/services/dispatch';
import { eq } from 'drizzle-orm';
import type { ReactNode } from 'react';
import {
  acceptAction,
  confirmChangeAction,
  declineAction,
  submitCompletionAction,
} from './actions';

export const dynamic = 'force-dynamic';

function fmtTimeWithDay(at: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
}

export default async function DriverLinkPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string; status?: string }>;
}) {
  const { token } = await params;
  const search = await searchParams;

  if (search.status === 'accepted') {
    // Load the job so the confirmation can hand the driver their two ways back
    // in: this link, and a prefilled calendar event that links to it.
    const job = await previewDriverJob(token, {
      db: db(),
      secret: driverLinkSecret(),
      appUrl: appUrl(),
    });
    const jobUrl = `${appUrl().replace(/\/+$/, '')}/j/${token}`;
    return (
      <Stage>
        <div className="ph-center">
          <div className="ph-check">
            <Icon.Check />
          </div>
          <h1>Job accepted</h1>
          <p className="you">
            The operator and the passenger have been notified. <strong>Keep this link</strong> —
            reopen it any time to see the job details.
          </p>
        </div>
        {job.ok ? (
          <>
            <a href={jobUrl} className="btn btn--lg btn--block" style={{ marginTop: 12 }}>
              View job details
            </a>
            <a
              href={driverJobCalendarUrl(job.booking, jobUrl)}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn--block"
              style={{ marginTop: 6 }}
            >
              Add to Google Calendar
            </a>
          </>
        ) : null}
      </Stage>
    );
  }
  if (search.status === 'declined') {
    return (
      <Stage>
        <div className="ph-center">
          <h1>Job declined</h1>
          <p className="you">Thank you — the operator will reassign.</p>
        </div>
      </Stage>
    );
  }
  if (search.status === 'confirmed') {
    return (
      <Stage>
        <div className="ph-center">
          <div className="ph-check">
            <Icon.Check />
          </div>
          <h1>Change confirmed</h1>
          <p className="you">Thanks — the operator knows you're across the new plan.</p>
        </div>
      </Stage>
    );
  }
  if (search.status === 'submitted') {
    return (
      <Stage>
        <div className="ph-center">
          <div className="ph-check">
            <Icon.Check />
          </div>
          <h1>Submitted</h1>
          <p className="you">Thank you — the operator will review and approve.</p>
        </div>
      </Stage>
    );
  }

  const verified = await verifyDriverLink(driverLinkSecret(), token);
  if (!verified.ok) {
    return (
      <Stage>
        <div className="ph-center">
          <h1>Link unavailable</h1>
          <p className="you">
            {verified.reason === 'expired'
              ? 'This link has expired.'
              : 'Sorry, this link is not valid.'}
          </p>
        </div>
      </Stage>
    );
  }

  if (verified.payload.type === 'completion') {
    return <CompletionPage token={token} search={search} />;
  }

  if (verified.payload.type === 'change_confirm') {
    return <ChangeConfirmPage token={token} search={search} />;
  }

  const result = await previewDispatchLink(token, {
    db: db(),
    secret: driverLinkSecret(),
    appUrl: appUrl(),
  });

  if (!result.ok) {
    // A consumed or closed offer link may still be the assigned driver's own
    // link — show them their job instead of a dead end so they can keep track.
    if (result.reason === 'token_consumed' || result.reason === 'wrong_state') {
      const job = await previewDriverJob(token, {
        db: db(),
        secret: driverLinkSecret(),
        appUrl: appUrl(),
      });
      if (job.ok) {
        const jobUrl = `${appUrl().replace(/\/+$/, '')}/j/${token}`;
        return <DriverJobView booking={job.booking} driver={job.driver} jobUrl={jobUrl} />;
      }
      if (job.reason === 'cancelled') {
        return (
          <Stage>
            <div className="ph-center">
              <h1>Booking cancelled</h1>
              <p className="you">This booking has been cancelled. Nothing more to do.</p>
            </div>
          </Stage>
        );
      }
    }
    return (
      <Stage>
        <div className="ph-center">
          <h1>Link unavailable</h1>
          <p className="you">
            {result.reason === 'token_expired'
              ? 'This link has expired.'
              : result.reason === 'token_consumed'
                ? 'This job has already been accepted.'
                : result.reason === 'wrong_state'
                  ? 'This job is no longer open.'
                  : 'Sorry, this link is not valid.'}
          </p>
        </div>
      </Stage>
    );
  }

  const { booking, driver } = result.preview;
  const passengerName = `${booking.passengerFirstName} ${booking.passengerLastName}`.trim();

  return (
    <Stage>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Avatar name={driver.name} id={driver.id} size={36} />
        <div>
          <div
            style={{
              fontSize: 10.5,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              fontWeight: 600,
              color: 'var(--ink-3)',
            }}
          >
            Job offer for
          </div>
          <strong style={{ fontSize: 14 }}>{driver.name}</strong>
        </div>
        <span style={{ flex: 1 }} />
        <Lozenge tone="blue">NEW OFFER</Lozenge>
      </div>

      <h1>{passengerName}</h1>

      {search.error ? <div className="ph-error">{decodeURIComponent(search.error)}</div> : null}

      <JobCard booking={booking} />

      <div
        style={{
          fontSize: 12,
          color: 'var(--ink-3)',
          borderTop: '1px solid var(--hairline-soft)',
          paddingTop: 10,
          marginTop: 10,
        }}
      >
        <strong style={{ color: 'var(--ink)' }}>Your car:</strong>{' '}
        {carDescription(driver.car, driver.carColour)}
      </div>
      <form action={acceptAction}>
        <input type="hidden" name="token" value={token} />
        <button
          type="submit"
          className="btn btn--success btn--lg btn--block"
          style={{ marginTop: 12 }}
        >
          <Icon.Check /> Accept job
        </button>
      </form>
      <form action={declineAction}>
        <input type="hidden" name="token" value={token} />
        <button
          type="submit"
          className="btn btn--block"
          style={{ marginTop: 6, color: 'var(--lz-red-fg)' }}
        >
          Decline
        </button>
      </form>

      <div style={{ fontSize: 10.5, color: 'var(--ink-4)', textAlign: 'center', marginTop: 12 }}>
        By accepting, you confirm you are {driver.name}.
      </div>
    </Stage>
  );
}

type JobBooking = typeof bookingsTable.$inferSelect;
type JobDriver = typeof driversTable.$inferSelect;

/** The job facts card shared by the dispatch offer and the accepted-job view. */
function JobCard({ booking }: { booking: JobBooking }) {
  return (
    <div className="public-card__job">
      <div className="row">
        <span className="pin" />
        <div className="addr">
          <div className="lbl">Pickup · {fmtTimeWithDay(booking.pickupAt)}</div>
          {booking.pickupAddress}
        </div>
      </div>
      <div className="row">
        <span className="pin to" />
        <div className="addr">
          <div className="lbl">Drop-off</div>
          {booking.dropoffAddress ?? 'As directed'}
        </div>
      </div>
      <div className="meta">
        <div className="m">
          <div className="k">Duration</div>
          <div className="v">{booking.expectedDurationMinutes} min</div>
        </div>
        {booking.travelRef ? (
          <div className="m">
            <div className="k">{booking.travelMode === 'flight' ? 'Flight' : 'Train'}</div>
            <div className="v">{booking.travelRef}</div>
          </div>
        ) : null}
      </div>
      {booking.notes ? (
        <div
          style={{
            fontSize: 12,
            color: 'var(--ink-3)',
            borderTop: '1px solid var(--hairline-soft)',
            paddingTop: 10,
          }}
        >
          <strong style={{ color: 'var(--ink)' }}>Note:</strong> {booking.notes}
        </div>
      ) : null}
    </div>
  );
}

/** Driver-facing status line for the accepted-job view. */
function jobStatus(state: string): { label: string; tone: 'green' | 'blue' | 'yellow' } {
  switch (state) {
    case 'in_progress':
      return { label: 'IN PROGRESS', tone: 'blue' };
    case 'awaiting_driver_form':
      return { label: 'AWAITING YOUR TRIP FORM', tone: 'yellow' };
    case 'awaiting_operator_review':
      return { label: 'SUBMITTED - UNDER REVIEW', tone: 'blue' };
    case 'completed':
      return { label: 'COMPLETED', tone: 'green' };
    default:
      return { label: 'CONFIRMED - YOUR JOB', tone: 'green' };
  }
}

/**
 * Read-only view of a job for the driver who accepted it. Reached by reopening
 * the original dispatch link (kept in their WhatsApp history) after acceptance;
 * lives until the link expires at pickup + 48h.
 */
function DriverJobView({
  booking,
  driver,
  jobUrl,
}: {
  booking: JobBooking;
  driver: JobDriver;
  jobUrl: string;
}) {
  const passengerName = `${booking.passengerFirstName} ${booking.passengerLastName ?? ''}`.trim();
  const status = jobStatus(booking.state);
  return (
    <Stage>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Avatar name={driver.name} id={driver.id} size={36} />
        <div>
          <div
            style={{
              fontSize: 10.5,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              fontWeight: 600,
              color: 'var(--ink-3)',
            }}
          >
            Your job
          </div>
          <strong style={{ fontSize: 14 }}>{driver.name}</strong>
        </div>
        <span style={{ flex: 1 }} />
        <Lozenge tone={status.tone}>{status.label}</Lozenge>
      </div>

      <h1>{passengerName}</h1>

      <JobCard booking={booking} />

      <div
        style={{
          fontSize: 12,
          color: 'var(--ink-3)',
          borderTop: '1px solid var(--hairline-soft)',
          paddingTop: 10,
          marginTop: 10,
        }}
      >
        <strong style={{ color: 'var(--ink)' }}>Your car:</strong>{' '}
        {carDescription(driver.car, driver.carColour)}
      </div>

      {booking.state === 'assigned' || booking.state === 'in_progress' ? (
        <a
          href={driverJobCalendarUrl(booking, jobUrl)}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn--block"
          style={{ marginTop: 12 }}
        >
          Add to Google Calendar
        </a>
      ) : null}

      <div style={{ fontSize: 10.5, color: 'var(--ink-4)', textAlign: 'center', marginTop: 12 }}>
        {booking.state === 'awaiting_driver_form'
          ? 'The operator has sent (or will send) your trip form link separately.'
          : 'Keep this link to check the job details any time.'}
      </div>
    </Stage>
  );
}

async function CompletionPage({
  token,
  search,
}: {
  token: string;
  search: { error?: string };
}) {
  const verified = await verifyDriverLink(driverLinkSecret(), token);
  if (!verified.ok) {
    return (
      <Stage>
        <div className="ph-center">
          <h1>Link unavailable</h1>
          <p className="you">Sorry, this link is not valid.</p>
        </div>
      </Stage>
    );
  }
  const { jobId, driverId, jti } = verified.payload;
  const database = db();
  const [used] = await database
    .select()
    .from(consumedTokens)
    .where(eq(consumedTokens.jti, jti))
    .limit(1);
  if (used) {
    return (
      <Stage>
        <div className="ph-center">
          <h1>Already submitted</h1>
          <p className="you">Thank you — this form has been received.</p>
        </div>
      </Stage>
    );
  }
  const [booking] = await database
    .select()
    .from(bookingsTable)
    .where(eq(bookingsTable.id, jobId))
    .limit(1);
  if (!booking || booking.state !== 'awaiting_driver_form') {
    return (
      <Stage>
        <div className="ph-center">
          <h1>Link unavailable</h1>
          <p className="you">This form is no longer open.</p>
        </div>
      </Stage>
    );
  }
  const [driver] = await database
    .select()
    .from(driversTable)
    .where(eq(driversTable.id, driverId))
    .limit(1);

  return (
    <Stage>
      <h1>Trip completion</h1>
      <p className="you">
        For driver <strong>{driver?.name ?? booking.backfillDriverName ?? 'unknown'}</strong>. A few
        quick fields and you're done.
      </p>
      {search.error ? <div className="ph-error">{decodeURIComponent(search.error)}</div> : null}
      <form action={submitCompletionAction} style={{ marginTop: 14 }}>
        <input type="hidden" name="token" value={token} />
        <div className="field">
          <label htmlFor="waitingMinutes">
            Waiting time (minutes) <span className="req">*</span>
          </label>
          <input
            id="waitingMinutes"
            className="input"
            type="number"
            inputMode="numeric"
            min={0}
            max={720}
            step={1}
            name="waitingMinutes"
            defaultValue={0}
            required
          />
          <div className="hint">
            How long you waited for the passenger. Enter 0 if they were on time.
          </div>
        </div>
        <div className="field">
          <label htmlFor="completionTime">
            Completion time <span className="req">*</span>
          </label>
          <input id="completionTime" className="input" type="time" name="completionTime" required />
          <div className="hint">When you dropped them off.</div>
        </div>
        <div className="field">
          <label htmlFor="parkingFeePounds">
            Parking fee (£) <span className="req">*</span>
          </label>
          <input
            id="parkingFeePounds"
            className="input"
            type="number"
            name="parkingFeePounds"
            step="0.01"
            min={0}
            max={1000}
            defaultValue={0}
            required
          />
        </div>
        <button
          type="submit"
          className="btn btn--primary btn--lg btn--block"
          style={{ marginTop: 12 }}
        >
          Submit
        </button>
      </form>
    </Stage>
  );
}

async function ChangeConfirmPage({
  token,
  search,
}: {
  token: string;
  search: { error?: string };
}) {
  const result = await previewChangeConfirmLink(token, {
    db: db(),
    secret: driverLinkSecret(),
  });

  if (!result.ok) {
    return (
      <Stage>
        <div className="ph-center">
          <h1>
            {result.reason === 'no_pending_change' ? 'Nothing to confirm' : 'Link unavailable'}
          </h1>
          <p className="you">
            {result.reason === 'token_expired'
              ? 'This link has expired.'
              : result.reason === 'no_pending_change'
                ? 'This change has already been confirmed, or there is no change outstanding.'
                : 'Sorry, this link is not valid.'}
          </p>
        </div>
      </Stage>
    );
  }

  const { booking, driver } = result;
  const passengerLabel = `${booking.passengerFirstName} ${booking.passengerLastName ?? ''}`.trim();

  return (
    <Stage>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Avatar name={driver.name} id={driver.id} size={36} />
        <div>
          <div
            style={{
              fontSize: 10.5,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              fontWeight: 600,
              color: 'var(--ink-3)',
            }}
          >
            Updated job for
          </div>
          <strong style={{ fontSize: 14 }}>{driver.name}</strong>
        </div>
        <span style={{ flex: 1 }} />
        <Lozenge tone="orange">CHANGED</Lozenge>
      </div>

      <h1>{passengerLabel}</h1>

      {search.error ? <div className="ph-error">{decodeURIComponent(search.error)}</div> : null}

      <div className="public-card__job">
        <div className="row">
          <span className="pin" />
          <div className="addr">
            <div className="lbl">Pickup · {fmtTimeWithDay(booking.pickupAt)}</div>
            {booking.pickupAddress}
          </div>
        </div>
        {booking.dropoffAddress ? (
          <div className="row">
            <span className="pin to" />
            <div className="addr">
              <div className="lbl">Drop-off</div>
              {booking.dropoffAddress}
            </div>
          </div>
        ) : null}
        <div className="meta">
          <div className="m">
            <div className="k">Duration</div>
            <div className="v">{booking.expectedDurationMinutes} min</div>
          </div>
          {booking.travelRef ? (
            <div className="m">
              <div className="k">{booking.travelMode === 'flight' ? 'Flight' : 'Train'}</div>
              <div className="v">{booking.travelRef}</div>
            </div>
          ) : null}
        </div>
        {booking.notes ? (
          <div
            style={{
              fontSize: 12,
              color: 'var(--ink-3)',
              borderTop: '1px solid var(--hairline-soft)',
              paddingTop: 10,
            }}
          >
            <strong style={{ color: 'var(--ink)' }}>Note:</strong> {booking.notes}
          </div>
        ) : null}
      </div>

      <form action={confirmChangeAction}>
        <input type="hidden" name="token" value={token} />
        <button
          type="submit"
          className="btn btn--success btn--lg btn--block"
          style={{ marginTop: 12 }}
        >
          <Icon.Check /> Confirm the new details
        </button>
      </form>

      <div style={{ fontSize: 10.5, color: 'var(--ink-4)', textAlign: 'center', marginTop: 12 }}>
        By confirming, you agree to the updated job above.
      </div>
    </Stage>
  );
}

function Stage({ children }: { children: ReactNode }) {
  return (
    <div className="public-stage">
      <div className="public-card">{children}</div>
    </div>
  );
}
