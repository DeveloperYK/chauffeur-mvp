import { env } from '@/lib/env';
import { getDb } from '@/server/db';
import type { Booking, BookingState } from '@/server/db/schema';
import { groupByState, listActiveBookings } from '@/server/services/bookings-query';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const COLUMNS: { state: BookingState; label: string; tint: string }[] = [
  { state: 'unassigned', label: 'Unassigned', tint: '#fef3c7' },
  { state: 'assigned', label: 'Assigned', tint: '#dbeafe' },
  { state: 'in_progress', label: 'In Progress', tint: '#e0e7ff' },
  { state: 'awaiting_driver_form', label: 'Awaiting Driver Form', tint: '#fde68a' },
  { state: 'awaiting_operator_review', label: 'Awaiting Operator Review', tint: '#fed7aa' },
  { state: 'completed', label: 'Completed', tint: '#d1fae5' },
  { state: 'cancelled', label: 'Cancelled', tint: '#e5e7eb' },
];

export default async function DashboardHome() {
  const url = env().DATABASE_URL;
  if (!url) {
    return <p style={{ color: '#b91c1c' }}>DATABASE_URL not configured.</p>;
  }
  const { db } = getDb(url);
  const rows = await listActiveBookings(db);
  const board = groupByState(rows);

  return (
    <div>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: '1rem',
        }}
      >
        <h1 style={{ margin: 0 }}>Dispatch board</h1>
        <Link
          href="/dashboard/new"
          style={{
            padding: '0.5rem 0.9rem',
            background: '#0f172a',
            color: 'white',
            borderRadius: 6,
            textDecoration: 'none',
            fontWeight: 600,
          }}
        >
          + New booking
        </Link>
      </header>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, minmax(220px, 1fr))',
          gap: '0.75rem',
          overflowX: 'auto',
        }}
      >
        {COLUMNS.map((col) => {
          const items = board[col.state];
          return (
            <section
              key={col.state}
              aria-label={col.label}
              style={{
                background: col.tint,
                borderRadius: 8,
                padding: '0.75rem',
                minHeight: 200,
              }}
            >
              <header style={{ marginBottom: '0.5rem' }}>
                <strong>{col.label}</strong>{' '}
                <span style={{ color: '#475569' }}>({items.length})</span>
              </header>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
                {items.map((b) => (
                  <BookingCard key={b.id} booking={b} />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function BookingCard({ booking }: { booking: Booking }) {
  return (
    <li
      style={{
        background: 'white',
        borderRadius: 6,
        padding: '0.5rem 0.6rem',
        boxShadow: '0 1px 0 rgba(0,0,0,0.06)',
        fontSize: 13,
      }}
    >
      <div style={{ fontWeight: 600 }}>
        {booking.passengerFirstName} {booking.passengerLastName}
      </div>
      <div style={{ color: '#475569', fontSize: 12 }}>
        {booking.pickupAt.toISOString().replace('T', ' ').slice(0, 16)} UTC
      </div>
      <div style={{ color: '#475569', fontSize: 12 }}>
        {booking.pickupAddress.slice(0, 40)}
        {booking.pickupAddress.length > 40 ? '…' : ''}
        {' → '}
        {booking.dropoffAddress.slice(0, 40)}
        {booking.dropoffAddress.length > 40 ? '…' : ''}
      </div>
      <div style={{ color: '#475569', fontSize: 12 }}>
        Account: {booking.accountCode} · £{(booking.contractPricePence / 100).toFixed(2)}
      </div>
    </li>
  );
}
