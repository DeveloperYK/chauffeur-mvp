import { env } from '@/lib/env';
import { getDb } from '@/server/db';
import { listActivity } from '@/server/services/activity';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

function fmtTs(d: Date): string {
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

function relTime(d: Date): string {
  const diff = Date.now() - d.getTime();
  const mins = Math.round(diff / 60000);
  if (Math.abs(mins) < 1) return 'just now';
  if (Math.abs(mins) < 60) return mins > 0 ? `${mins}m ago` : `in ${-mins}m`;
  const hrs = Math.round(mins / 60);
  if (Math.abs(hrs) < 24) return hrs > 0 ? `${hrs}h ago` : `in ${-hrs}h`;
  const days = Math.round(hrs / 24);
  return days > 0 ? `${days}d ago` : `in ${-days}d`;
}

export default async function ActivityPage() {
  const url = env().DATABASE_URL;
  if (!url) return <div className="content">DATABASE_URL not configured.</div>;
  const { db } = getDb(url);
  const events = await listActivity(db, 60);

  return (
    <>
      <div className="page-head">
        <div className="page-head__row">
          <h1 className="page-head__title">Activity</h1>
          <span className="page-head__sub dotsep-pre">Audit trail across the system</span>
        </div>
      </div>
      <div className="content" style={{ maxWidth: 820 }}>
        {events.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--ink-4)' }}>
            No activity yet.
          </div>
        ) : (
          <div className="activity-list">
            {events.map((e) => (
              <Link key={e.id} href={`/dashboard/bookings/${e.bookingId}`} className="activity-row">
                <span className="ts">
                  {fmtTs(e.ts)}
                  <small>{relTime(e.ts)}</small>
                </span>
                <span>
                  <strong>{e.actor}</strong> {e.text}
                </span>
                <span className="key mono">{e.bookingId.slice(0, 8)}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
