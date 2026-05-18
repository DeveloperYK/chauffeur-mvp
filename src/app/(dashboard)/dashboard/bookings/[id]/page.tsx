import { env } from '@/lib/env';
import { getDb } from '@/server/db';
import { bookings } from '@/server/db/schema';
import { listActiveDrivers } from '@/server/services/drivers';
import { eq } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  approveAction,
  generateCompletionLinkAction,
  generateLinkAction,
  rejectAction,
} from './actions';

export const dynamic = 'force-dynamic';

export default async function BookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ url?: string; wa?: string; error?: string }>;
}) {
  const { id } = await params;
  const search = await searchParams;
  const url = env().DATABASE_URL;
  if (!url) return <p style={{ color: '#b91c1c' }}>DATABASE_URL not configured.</p>;
  const { db } = getDb(url);
  const [booking] = await db.select().from(bookings).where(eq(bookings.id, id)).limit(1);
  if (!booking) notFound();
  const driverList = await listActiveDrivers(db);

  return (
    <div style={{ maxWidth: 760 }}>
      <Link href="/dashboard" style={{ color: '#2563eb' }}>
        ← Back to board
      </Link>
      <h1 style={{ marginTop: '0.5rem' }}>
        Booking · {booking.passengerFirstName} {booking.passengerLastName}
      </h1>
      <p style={{ color: '#475569', marginTop: 0 }}>
        State: <strong>{booking.state}</strong> · Pickup{' '}
        {booking.pickupAt.toISOString().replace('T', ' ').slice(0, 16)} UTC
      </p>

      <section style={panel}>
        <h2 style={{ marginTop: 0 }}>Details</h2>
        <dl style={dl}>
          <dt>From</dt>
          <dd>{booking.pickupAddress}</dd>
          <dt>To</dt>
          <dd>{booking.dropoffAddress}</dd>
          <dt>Exec mobile</dt>
          <dd>
            <code>{booking.execMobile}</code>
          </dd>
          <dt>Booker</dt>
          <dd>{booking.bookerName}</dd>
          <dt>Account</dt>
          <dd>{booking.accountCode}</dd>
          <dt>Price</dt>
          <dd>£{(booking.contractPricePence / 100).toFixed(2)}</dd>
          <dt>Duration</dt>
          <dd>{booking.expectedDurationMinutes} min</dd>
          <dt>Car preference</dt>
          <dd>{booking.carTypePreference}</dd>
          {booking.notes ? (
            <>
              <dt>Notes</dt>
              <dd>{booking.notes}</dd>
            </>
          ) : null}
        </dl>
      </section>

      {booking.state === 'unassigned' ? (
        <section style={panel}>
          <h2 style={{ marginTop: 0 }}>Dispatch</h2>
          {search.error ? (
            <div role="alert" style={errorBox}>
              {decodeURIComponent(search.error)}
            </div>
          ) : null}
          {search.url ? (
            <div style={{ marginBottom: '0.75rem' }}>
              <p style={{ marginBottom: 4 }}>Driver link generated:</p>
              <p>
                <a href={search.url} style={{ color: '#2563eb', wordBreak: 'break-all' }}>
                  {decodeURIComponent(search.url)}
                </a>
              </p>
              {search.wa ? (
                <a
                  href={decodeURIComponent(search.wa)}
                  rel="noopener noreferrer"
                  target="_blank"
                  style={{
                    display: 'inline-block',
                    padding: '0.5rem 0.9rem',
                    background: '#25d366',
                    color: 'white',
                    borderRadius: 6,
                    textDecoration: 'none',
                    fontWeight: 600,
                  }}
                >
                  Send via WhatsApp →
                </a>
              ) : null}
            </div>
          ) : null}
          <form action={generateLinkAction} style={{ display: 'flex', gap: '0.5rem' }}>
            <input type="hidden" name="bookingId" value={booking.id} />
            <select name="driverId" required style={selectStyle} defaultValue="">
              <option value="" disabled>
                Choose a driver…
              </option>
              {driverList.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.tier === 'premium' ? '★ ' : ''}
                  {d.name} ({d.defaultCarType}) — {d.whatsappNumber}
                </option>
              ))}
            </select>
            <button
              type="submit"
              style={{
                padding: '0.5rem 0.9rem',
                background: '#0f172a',
                color: 'white',
                borderRadius: 6,
                border: 'none',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Generate link
            </button>
          </form>
        </section>
      ) : null}

      {booking.state === 'assigned' && booking.assignedDriverId ? (
        <section style={panel}>
          <h2 style={{ marginTop: 0 }}>Assigned</h2>
          <p>
            Driver ID: <code>{booking.assignedDriverId}</code> · Car:{' '}
            <strong>{booking.carForThisJob}</strong>
          </p>
        </section>
      ) : null}

      {booking.state === 'awaiting_driver_form' ? (
        <section style={panel}>
          <h2 style={{ marginTop: 0 }}>Awaiting driver completion form</h2>
          {search.url ? (
            <div>
              <p>Completion link:</p>
              <p>
                <a href={search.url} style={{ color: '#2563eb', wordBreak: 'break-all' }}>
                  {decodeURIComponent(search.url)}
                </a>
              </p>
              {search.wa ? (
                <a
                  href={decodeURIComponent(search.wa)}
                  rel="noopener noreferrer"
                  target="_blank"
                  style={{
                    display: 'inline-block',
                    padding: '0.5rem 0.9rem',
                    background: '#25d366',
                    color: 'white',
                    borderRadius: 6,
                    textDecoration: 'none',
                    fontWeight: 600,
                  }}
                >
                  Send via WhatsApp →
                </a>
              ) : null}
            </div>
          ) : (
            <CompletionLinkForm bookingId={booking.id} />
          )}
        </section>
      ) : null}

      {booking.state === 'awaiting_operator_review' ? (
        <section style={panel}>
          <h2 style={{ marginTop: 0 }}>Review submitted form</h2>
          <dl style={dl}>
            <dt>Car park</dt>
            <dd>£{((booking.carParkPence ?? 0) / 100).toFixed(2)}</dd>
            <dt>Waiting time</dt>
            <dd>{booking.waitingTimeMinutes ?? 0} min</dd>
            <dt>Drop-off</dt>
            <dd>
              {booking.dropoffAt
                ? booking.dropoffAt.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
                : '—'}
            </dd>
          </dl>
          <ReviewButtons bookingId={booking.id} />
        </section>
      ) : null}

      {booking.state === 'completed' ? (
        <section style={panel}>
          <h2 style={{ marginTop: 0 }}>Completed</h2>
          <dl style={dl}>
            <dt>Car park</dt>
            <dd>£{((booking.carParkPence ?? 0) / 100).toFixed(2)}</dd>
            <dt>Waiting time</dt>
            <dd>{booking.waitingTimeMinutes ?? 0} min</dd>
            <dt>Drop-off</dt>
            <dd>
              {booking.dropoffAt
                ? booking.dropoffAt.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
                : '—'}
            </dd>
          </dl>
        </section>
      ) : null}
    </div>
  );
}

function CompletionLinkForm({ bookingId }: { bookingId: string }) {
  return (
    <form action={generateCompletionLinkAction}>
      <input type="hidden" name="bookingId" value={bookingId} />
      <button type="submit" style={primaryDark}>
        Generate completion link
      </button>
    </form>
  );
}

function ReviewButtons({ bookingId }: { bookingId: string }) {
  return (
    <div style={{ display: 'flex', gap: '0.5rem' }}>
      <form action={approveAction}>
        <input type="hidden" name="bookingId" value={bookingId} />
        <button type="submit" style={primaryGreen}>
          Approve
        </button>
      </form>
      <form action={rejectAction}>
        <input type="hidden" name="bookingId" value={bookingId} />
        <button type="submit" style={secondaryRed}>
          Reject — driver to resubmit
        </button>
      </form>
    </div>
  );
}

const primaryDark: React.CSSProperties = {
  padding: '0.5rem 0.9rem',
  background: '#0f172a',
  color: 'white',
  borderRadius: 6,
  border: 'none',
  fontWeight: 600,
  cursor: 'pointer',
};

const primaryGreen: React.CSSProperties = {
  padding: '0.5rem 0.9rem',
  background: '#16a34a',
  color: 'white',
  borderRadius: 6,
  border: 'none',
  fontWeight: 600,
  cursor: 'pointer',
};

const secondaryRed: React.CSSProperties = {
  padding: '0.5rem 0.9rem',
  background: 'white',
  color: '#b91c1c',
  border: '1px solid #fca5a5',
  borderRadius: 6,
  fontWeight: 600,
  cursor: 'pointer',
};

const panel: React.CSSProperties = {
  background: 'white',
  padding: '1rem 1.2rem',
  borderRadius: 8,
  marginTop: '1rem',
  boxShadow: '0 1px 0 rgba(0,0,0,0.06)',
};

const dl: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '160px 1fr',
  gap: '0.4rem 1rem',
  margin: 0,
};

const selectStyle: React.CSSProperties = {
  flex: 1,
  padding: '0.5rem 0.6rem',
  borderRadius: 6,
  border: '1px solid #cbd5e1',
  fontSize: 14,
};

const errorBox: React.CSSProperties = {
  padding: '0.5rem 0.75rem',
  background: '#fee2e2',
  border: '1px solid #fecaca',
  borderRadius: 6,
  marginBottom: '0.75rem',
};
