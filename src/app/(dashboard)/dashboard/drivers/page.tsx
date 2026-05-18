import { env } from '@/lib/env';
import { getDb } from '@/server/db';
import { listAllDrivers } from '@/server/services/drivers';
import Link from 'next/link';
import { deactivateDriverAction, reactivateDriverAction } from './actions';

export const dynamic = 'force-dynamic';

const CAR_LABEL: Record<string, string> = {
  ex: 'EX',
  s_class: 'S Class',
  mpv: 'MPV',
  mini_bus: 'Mini Bus',
};

export default async function DriversPage() {
  const url = env().DATABASE_URL;
  if (!url) return <p style={{ color: '#b91c1c' }}>DATABASE_URL not configured.</p>;
  const { db } = getDb(url);
  const drivers = await listAllDrivers(db);

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
        <div>
          <Link href="/dashboard" style={{ color: '#2563eb' }}>
            ← Back to board
          </Link>
          <h1 style={{ margin: '0.5rem 0 0' }}>Driver roster</h1>
        </div>
        <Link
          href="/dashboard/drivers/new"
          style={{
            padding: '0.5rem 0.9rem',
            background: '#0f172a',
            color: 'white',
            borderRadius: 6,
            textDecoration: 'none',
            fontWeight: 600,
          }}
        >
          + Add driver
        </Link>
      </header>

      <table style={{ width: '100%', borderCollapse: 'collapse', background: 'white' }}>
        <thead style={{ background: '#f1f5f9' }}>
          <tr>
            <Th>Name</Th>
            <Th>Tier</Th>
            <Th>Default car</Th>
            <Th>WhatsApp</Th>
            <Th>Status</Th>
            <Th>Actions</Th>
          </tr>
        </thead>
        <tbody>
          {drivers.length === 0 ? (
            <tr>
              <td colSpan={6} style={{ padding: '1rem', textAlign: 'center', color: '#64748b' }}>
                No drivers yet. Add one to get started.
              </td>
            </tr>
          ) : (
            drivers.map((d) => (
              <tr key={d.id} style={{ borderTop: '1px solid #e2e8f0' }}>
                <Td>
                  <strong>{d.name}</strong>
                </Td>
                <Td style={{ textTransform: 'capitalize' }}>{d.tier}</Td>
                <Td>{CAR_LABEL[d.defaultCarType] ?? d.defaultCarType}</Td>
                <Td>
                  <code>{d.whatsappNumber}</code>
                </Td>
                <Td>
                  <span
                    style={{
                      padding: '0.15rem 0.5rem',
                      borderRadius: 999,
                      fontSize: 12,
                      background: d.active ? '#d1fae5' : '#e5e7eb',
                      color: d.active ? '#047857' : '#475569',
                    }}
                  >
                    {d.active ? 'Active' : 'Inactive'}
                  </span>
                </Td>
                <Td>
                  <Link href={`/dashboard/drivers/${d.id}/edit`} style={{ color: '#2563eb' }}>
                    Edit
                  </Link>
                  {' · '}
                  {d.active ? (
                    <form action={deactivateDriverAction} style={{ display: 'inline' }}>
                      <input type="hidden" name="id" value={d.id} />
                      <button
                        type="submit"
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#b91c1c',
                          cursor: 'pointer',
                          padding: 0,
                          font: 'inherit',
                        }}
                      >
                        Deactivate
                      </button>
                    </form>
                  ) : (
                    <form action={reactivateDriverAction} style={{ display: 'inline' }}>
                      <input type="hidden" name="id" value={d.id} />
                      <button
                        type="submit"
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#047857',
                          cursor: 'pointer',
                          padding: 0,
                          font: 'inherit',
                        }}
                      >
                        Reactivate
                      </button>
                    </form>
                  )}
                </Td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th style={{ textAlign: 'left', padding: '0.6rem 0.8rem', fontSize: 13, color: '#475569' }}>
      {children}
    </th>
  );
}

function Td({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return <td style={{ padding: '0.6rem 0.8rem', fontSize: 14, ...style }}>{children}</td>;
}
