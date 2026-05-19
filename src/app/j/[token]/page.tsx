import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { COMMON_CARS } from '@/lib/labels';
import { appUrl, db, driverLinkSecret } from '@/server/composition';
import {
  bookings as bookingsTable,
  consumedTokens,
  drivers as driversTable,
} from '@/server/db/schema';
import { verifyDriverLink } from '@/server/domain/link-tokens';
import { previewDispatchLink } from '@/server/services/dispatch';
import { eq } from 'drizzle-orm';
import { acceptAction, declineAction, submitCompletionAction } from './actions';

export const dynamic = 'force-dynamic';

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
      <DriverShell>
        <h1 className="mb-1 text-lg font-semibold text-ink">Job accepted</h1>
        <p className="text-sm text-ink-muted">The operator and the passenger have been notified.</p>
      </DriverShell>
    );
  }
  if (search.status === 'declined') {
    return (
      <DriverShell>
        <h1 className="mb-1 text-lg font-semibold text-ink">Job declined</h1>
        <p className="text-sm text-ink-muted">Thank you — the operator will reassign.</p>
      </DriverShell>
    );
  }
  if (search.status === 'submitted') {
    return (
      <DriverShell>
        <h1 className="mb-1 text-lg font-semibold text-ink">Submitted</h1>
        <p className="text-sm text-ink-muted">Thank you — the operator will review and approve.</p>
      </DriverShell>
    );
  }

  const verified = await verifyDriverLink(driverLinkSecret(), token);
  if (!verified.ok) {
    return (
      <DriverShell>
        <h1 className="mb-1 text-lg font-semibold text-ink">Link unavailable</h1>
        <p className="text-sm text-ink-muted">
          {verified.reason === 'expired'
            ? 'This link has expired.'
            : 'Sorry, this link is not valid.'}
        </p>
      </DriverShell>
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
      <DriverShell>
        <h1 className="mb-1 text-lg font-semibold text-ink">Link unavailable</h1>
        <p className="text-sm text-ink-muted">
          {result.reason === 'token_expired'
            ? 'This link has expired.'
            : result.reason === 'token_consumed'
              ? 'This job has already been accepted.'
              : result.reason === 'wrong_state'
                ? 'This job is no longer open.'
                : 'Sorry, this link is not valid.'}
        </p>
      </DriverShell>
    );
  }

  const { booking, driver } = result.preview;
  return (
    <DriverShell>
      <h1 className="mb-1 text-lg font-semibold text-ink">Job offer for {driver.name}</h1>
      <p className="mb-4 text-sm text-ink-muted">
        Please confirm you are <strong>{driver.name}</strong> before accepting.
      </p>

      {search.error ? (
        <Alert tone="danger" className="mb-3">
          {decodeURIComponent(search.error)}
        </Alert>
      ) : null}

      <dl className="mb-5 grid grid-cols-[100px_1fr] gap-x-4 gap-y-2 text-sm">
        <Dt>Pickup</Dt>
        <Dd>{booking.pickupAt.toISOString().replace('T', ' ').slice(0, 16)} UTC</Dd>
        <Dt>From</Dt>
        <Dd>{booking.pickupAddress}</Dd>
        <Dt>To</Dt>
        <Dd>{booking.dropoffAddress}</Dd>
        <Dt>Duration</Dt>
        <Dd>{booking.expectedDurationMinutes} minutes</Dd>
        <Dt>Price</Dt>
        <Dd>£{(booking.contractPricePence / 100).toFixed(2)}</Dd>
      </dl>

      <form action={acceptAction} className="space-y-3">
        <input type="hidden" name="token" value={token} />
        <Field
          label="Vehicle for this job"
          helper="Defaults to your usual. Type any car you'll use."
        >
          <Input
            type="text"
            name="carForJob"
            maxLength={80}
            list="car-suggestions"
            defaultValue={driver.defaultCarType}
          />
          <datalist id="car-suggestions">
            {COMMON_CARS.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Button variant="success" type="submit" className="w-full justify-center text-base h-11">
          Accept job
        </Button>
      </form>
      <form action={declineAction} className="mt-2">
        <input type="hidden" name="token" value={token} />
        <Button variant="ghost" type="submit" className="w-full justify-center">
          Decline
        </Button>
      </form>
    </DriverShell>
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
      <DriverShell>
        <h1 className="mb-1 text-lg font-semibold text-ink">Link unavailable</h1>
        <p className="text-sm text-ink-muted">Sorry, this link is not valid.</p>
      </DriverShell>
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
      <DriverShell>
        <h1 className="mb-1 text-lg font-semibold text-ink">Already submitted</h1>
        <p className="text-sm text-ink-muted">Thank you — this form has been received.</p>
      </DriverShell>
    );
  }
  const [booking] = await database
    .select()
    .from(bookingsTable)
    .where(eq(bookingsTable.id, jobId))
    .limit(1);
  if (!booking || booking.state !== 'awaiting_driver_form') {
    return (
      <DriverShell>
        <h1 className="mb-1 text-lg font-semibold text-ink">Link unavailable</h1>
        <p className="text-sm text-ink-muted">This form is no longer open.</p>
      </DriverShell>
    );
  }
  const [driver] = await database
    .select()
    .from(driversTable)
    .where(eq(driversTable.id, driverId))
    .limit(1);

  return (
    <DriverShell>
      <h1 className="mb-1 text-lg font-semibold text-ink">Trip completion</h1>
      <p className="mb-4 text-sm text-ink-muted">
        For driver <strong>{driver?.name ?? 'unknown'}</strong>. Three quick fields and you're done.
      </p>
      {search.error ? (
        <Alert tone="danger" className="mb-3">
          {decodeURIComponent(search.error)}
        </Alert>
      ) : null}
      <form action={submitCompletionAction} className="space-y-3">
        <input type="hidden" name="token" value={token} />
        <Field label="Car park / waiting fee (£)" required>
          <Input
            type="number"
            name="carParkPounds"
            step="0.01"
            min={0}
            max={1000}
            defaultValue={0}
            required
          />
        </Field>
        <Field label="Waiting time (minutes)" required>
          <Input
            type="number"
            name="waitingTimeMinutes"
            min={0}
            max={720}
            defaultValue={0}
            required
          />
        </Field>
        <Field label="Drop-off time (UTC)" required>
          <Input type="datetime-local" name="dropoffAt" required />
        </Field>
        <Button variant="primary" type="submit" className="w-full justify-center text-base h-11">
          Submit
        </Button>
      </form>
    </DriverShell>
  );
}

function DriverShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center bg-surface-sunken p-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-6 shadow-card">
        {children}
      </div>
    </main>
  );
}

function Dt({ children }: { children: React.ReactNode }) {
  return (
    <dt className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{children}</dt>
  );
}

function Dd({ children }: { children: React.ReactNode }) {
  return <dd className="text-sm text-ink">{children}</dd>;
}
