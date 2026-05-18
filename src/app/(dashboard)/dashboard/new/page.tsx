import Link from 'next/link';
import { newBookingAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function NewBookingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; issues?: string }>;
}) {
  const params = await searchParams;
  return (
    <div style={{ maxWidth: 720 }}>
      <Link href="/dashboard" style={{ color: '#2563eb' }}>
        ← Back to board
      </Link>
      <h1>New booking</h1>
      {params.error ? (
        <div
          role="alert"
          style={{
            padding: '0.5rem 0.75rem',
            background: '#fee2e2',
            border: '1px solid #fecaca',
            borderRadius: 6,
            marginBottom: '1rem',
          }}
        >
          {decodeURIComponent(params.error)}
        </div>
      ) : null}
      <form action={newBookingAction} style={{ display: 'grid', gap: '0.75rem' }}>
        <Row label="Pickup (UTC)">
          <input type="datetime-local" name="pickupAt" required style={input} />
        </Row>
        <Row label="Expected duration (minutes)">
          <input
            type="number"
            name="expectedDurationMinutes"
            min={15}
            max={720}
            defaultValue={90}
            required
            style={input}
          />
        </Row>
        <Row label="Pickup address">
          <input type="text" name="pickupAddress" required maxLength={500} style={input} />
        </Row>
        <Row label="Drop-off address">
          <input type="text" name="dropoffAddress" required maxLength={500} style={input} />
        </Row>
        <Row label="Passenger first name">
          <input type="text" name="passengerFirstName" required maxLength={80} style={input} />
        </Row>
        <Row label="Passenger last name">
          <input type="text" name="passengerLastName" required maxLength={80} style={input} />
        </Row>
        <Row label="Exec mobile (E.164, e.g. +447700900123)">
          <input
            type="tel"
            name="execMobile"
            required
            placeholder="+447700900123"
            pattern="\\+[0-9]{6,18}"
            style={input}
          />
        </Row>
        <Row label="Booker name">
          <input type="text" name="bookerName" required maxLength={80} style={input} />
        </Row>
        <Row label="Account code">
          <input type="text" name="accountCode" required maxLength={40} style={input} />
        </Row>
        <Row label="Car type">
          <select name="carTypePreference" required defaultValue="s_class" style={input}>
            <option value="ex">EX</option>
            <option value="s_class">S Class</option>
            <option value="mpv">MPV</option>
            <option value="mini_bus">Mini Bus</option>
          </select>
        </Row>
        <Row label="Contract price (£)">
          <input
            type="number"
            name="contractPricePounds"
            step="0.01"
            min={0}
            max={10000}
            required
            style={input}
          />
        </Row>
        <Row label="Notes (optional)">
          <textarea name="notes" maxLength={2000} rows={3} style={input} />
        </Row>
        <button
          type="submit"
          style={{
            marginTop: '0.5rem',
            padding: '0.6rem 1rem',
            borderRadius: 6,
            background: '#0f172a',
            color: 'white',
            border: 'none',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Create booking
        </button>
      </form>
    </div>
  );
}

const input: React.CSSProperties = {
  padding: '0.5rem 0.6rem',
  borderRadius: 6,
  border: '1px solid #cbd5e1',
  fontSize: 14,
  width: '100%',
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <span style={{ fontSize: 13, color: '#334155' }}>{label}</span>
      {/* biome-ignore lint/a11y/noLabelWithoutControl: wrapper renders the control via children */}
      <label style={{ display: 'contents' }}>{children}</label>
    </div>
  );
}
