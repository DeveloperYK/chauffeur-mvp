import { appUrl, db, driverLinkSecret } from '@/server/composition';
import { previewDispatchLink } from '@/server/services/dispatch';
import { acceptAction, declineAction } from './actions';

export const dynamic = 'force-dynamic';

const CAR_OPTIONS: { value: string; label: string }[] = [
  { value: 'ex', label: 'EX' },
  { value: 's_class', label: 'S Class' },
  { value: 'mpv', label: 'MPV' },
  { value: 'mini_bus', label: 'Mini Bus' },
];

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
      <Wrapper>
        <h1>Job accepted</h1>
        <p style={{ color: '#475569' }}>The operator and the passenger have been notified.</p>
      </Wrapper>
    );
  }
  if (search.status === 'declined') {
    return (
      <Wrapper>
        <h1>Job declined</h1>
        <p style={{ color: '#475569' }}>Thank you — the operator will reassign.</p>
      </Wrapper>
    );
  }

  const result = await previewDispatchLink(token, {
    db: db(),
    secret: driverLinkSecret(),
    appUrl: appUrl(),
  });

  if (!result.ok) {
    return (
      <Wrapper>
        <h1>Link unavailable</h1>
        <p style={{ color: '#475569' }}>
          {result.reason === 'token_expired'
            ? 'This link has expired.'
            : result.reason === 'token_consumed'
              ? 'This job has already been accepted.'
              : result.reason === 'wrong_state'
                ? 'This job is no longer open.'
                : 'Sorry, this link is not valid.'}
        </p>
      </Wrapper>
    );
  }

  const { booking, driver } = result.preview;
  return (
    <Wrapper>
      <h1>Job offer for {driver.name}</h1>
      <p style={{ color: '#475569' }}>
        Please confirm you are <strong>{driver.name}</strong> before accepting.
      </p>

      {search.error ? (
        <div
          role="alert"
          style={{
            padding: '0.6rem 0.8rem',
            borderRadius: 6,
            background: '#fee2e2',
            color: '#7f1d1d',
            marginBottom: '0.75rem',
          }}
        >
          {decodeURIComponent(search.error)}
        </div>
      ) : null}

      <dl style={dlStyle}>
        <dt>Pickup</dt>
        <dd>{booking.pickupAt.toISOString().replace('T', ' ').slice(0, 16)} UTC</dd>
        <dt>From</dt>
        <dd>{booking.pickupAddress}</dd>
        <dt>To</dt>
        <dd>{booking.dropoffAddress}</dd>
        <dt>Duration</dt>
        <dd>{booking.expectedDurationMinutes} minutes</dd>
        <dt>Price</dt>
        <dd>£{(booking.contractPricePence / 100).toFixed(2)}</dd>
      </dl>

      <form action={acceptAction} style={{ marginTop: '1rem' }}>
        <input type="hidden" name="token" value={token} />
        <label style={{ display: 'grid', gap: 4, marginBottom: '0.75rem' }}>
          <span style={{ fontSize: 13, color: '#334155' }}>Vehicle (defaults to your usual)</span>
          <select name="carForJob" defaultValue={driver.defaultCarType} style={selectStyle}>
            {CAR_OPTIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" style={primary}>
          Accept job
        </button>
      </form>

      <form action={declineAction} style={{ marginTop: '0.5rem' }}>
        <input type="hidden" name="token" value={token} />
        <button type="submit" style={secondary}>
          Decline
        </button>
      </form>
    </Wrapper>
  );
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <main
      style={{
        minHeight: '100vh',
        padding: '1.5rem',
        fontFamily: 'system-ui, sans-serif',
        background: '#f8fafc',
        color: '#0f172a',
      }}
    >
      <div
        style={{
          maxWidth: 520,
          margin: '0 auto',
          background: 'white',
          borderRadius: 12,
          padding: '1.5rem',
          boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
        }}
      >
        {children}
      </div>
    </main>
  );
}

const dlStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '110px 1fr',
  gap: '0.4rem 1rem',
  margin: 0,
};

const selectStyle: React.CSSProperties = {
  padding: '0.5rem 0.6rem',
  borderRadius: 6,
  border: '1px solid #cbd5e1',
  fontSize: 14,
};

const primary: React.CSSProperties = {
  width: '100%',
  padding: '0.75rem',
  borderRadius: 6,
  background: '#16a34a',
  color: 'white',
  border: 'none',
  fontWeight: 700,
  cursor: 'pointer',
  fontSize: 16,
};

const secondary: React.CSSProperties = {
  width: '100%',
  padding: '0.6rem',
  borderRadius: 6,
  background: 'white',
  color: '#b91c1c',
  border: '1px solid #fca5a5',
  fontWeight: 600,
  cursor: 'pointer',
};
