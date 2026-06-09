import '@/app/console.css';
import { Avatar } from '@/components/console/avatar';
import { Icon } from '@/components/console/icons';
import { Lozenge } from '@/components/console/lozenge';
import { carDescription } from '@/lib/labels';
import { appUrl, db, driverLinkSecret } from '@/server/composition';
import {
  bookings as bookingsTable,
  consumedTokens,
  drivers as driversTable,
} from '@/server/db/schema';
import { verifyDriverLink } from '@/server/domain/link-tokens';
import { previewDispatchLink } from '@/server/services/dispatch';
import { eq } from 'drizzle-orm';
import type { ReactNode } from 'react';
import { acceptAction, declineAction, submitCompletionAction } from './actions';

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

function fmtPrice(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
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
    return (
      <Stage>
        <div className="ph-center">
          <div className="ph-check">
            <Icon.Check />
          </div>
          <h1>Job accepted</h1>
          <p className="you">The operator and the passenger have been notified.</p>
        </div>
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

  const result = await previewDispatchLink(token, {
    db: db(),
    secret: driverLinkSecret(),
    appUrl: appUrl(),
  });

  if (!result.ok) {
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
            {booking.dropoffAddress}
          </div>
        </div>
        <div className="meta">
          <div className="m">
            <div className="k">Duration</div>
            <div className="v">{booking.expectedDurationMinutes} min</div>
          </div>
          <div className="m">
            <div className="k">Price</div>
            <div className="v">{fmtPrice(booking.contractPricePence)}</div>
          </div>
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
        For driver <strong>{driver?.name ?? booking.backfillDriverName ?? 'unknown'}</strong>. Three
        quick fields and you're done.
      </p>
      {search.error ? <div className="ph-error">{decodeURIComponent(search.error)}</div> : null}
      <form action={submitCompletionAction} style={{ marginTop: 14 }}>
        <input type="hidden" name="token" value={token} />
        <div className="field">
          <label htmlFor="carParkPounds">
            Car park (£) <span className="req">*</span>
          </label>
          <input
            id="carParkPounds"
            className="input"
            type="number"
            name="carParkPounds"
            step="0.01"
            min={0}
            max={1000}
            defaultValue={0}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="waitingTimeMinutes">
            Waiting time (minutes) <span className="req">*</span>
          </label>
          <input
            id="waitingTimeMinutes"
            className="input"
            type="number"
            name="waitingTimeMinutes"
            min={0}
            max={720}
            defaultValue={0}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="dropoffAt">
            Drop-off time <span className="req">*</span>
          </label>
          <input id="dropoffAt" className="input" type="datetime-local" name="dropoffAt" required />
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

function Stage({ children }: { children: ReactNode }) {
  return (
    <div className="public-stage">
      <div className="public-card">{children}</div>
    </div>
  );
}
