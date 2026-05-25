import { Icon } from '@/components/console/icons';
import {
  formatLondonMonth,
  formatLondonMonthLong,
  londonTodayString,
  offsetMonth,
  parseMonthString,
} from '@/lib/dates';
import { env } from '@/lib/env';
import { currentSession } from '@/server/auth/current';
import { getDb } from '@/server/db';
import { reconcile } from '@/server/domain/reconcile';
import { listBillableBookings } from '@/server/services/bookings-query';
import Link from 'next/link';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

const gbp = (pence: number): string =>
  `£${(pence / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function fmtLineDate(d: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(d);
}

export default async function InvoicingPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const session = await currentSession();
  if (!session) redirect('/login');
  const url = env().DATABASE_URL;
  if (!url) return <div className="content">DATABASE_URL not configured.</div>;
  const { db } = getDb(url);

  const params = await searchParams;
  const thisMonth = formatLondonMonth(new Date(`${londonTodayString()}T12:00:00Z`));
  const month = params.month && parseMonthString(params.month) ? params.month : thisMonth;

  const bookings = await listBillableBookings(db, month);
  const report = reconcile(bookings);

  const prev = offsetMonth(month, -1);
  const next = offsetMonth(month, 1);
  const href = (m: string) => `/dashboard/invoicing?month=${m}`;

  return (
    <>
      <div className="page-head">
        <div className="page-head__row">
          <h1 className="page-head__title">Invoicing</h1>
          <span
            className="nav-pair"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Link className="icon-btn" href={href(prev)} aria-label="Previous month">
              <Icon.ChevLeft />
            </Link>
            <span className="page-head__sub" style={{ minWidth: 130, textAlign: 'center' }}>
              {formatLondonMonthLong(month)}
            </span>
            <Link className="icon-btn" href={href(next)} aria-label="Next month">
              <Icon.ChevRight />
            </Link>
          </span>
          {month !== thisMonth ? (
            <Link className="link-btn" href={href(thisMonth)}>
              ← This month
            </Link>
          ) : null}
          <span className="page-head__sub dotsep-pre">
            {report.tripCount} {report.tripCount === 1 ? 'trip' : 'trips'}
          </span>
          <span className="page-head__sub dotsep-pre tabnum">
            <strong>{gbp(report.grandTotalPence)}</strong>
          </span>
          <span style={{ flex: 1 }} />
          {report.tripCount > 0 ? (
            <a className="btn" href={`/dashboard/invoicing/export?month=${month}`}>
              <Icon.Copy /> Export CSV
            </a>
          ) : null}
        </div>
        <div className="page-head__strip">
          <span style={{ fontStyle: 'italic', color: 'var(--ink-4)' }}>
            Completed trips this month, grouped by customer account → case code (the expense
            account). Live view — reflects edits and cancellations.
          </span>
        </div>
      </div>

      <div className="content">
        {report.accounts.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--ink-4)' }}>
            No completed trips in {formatLondonMonthLong(month)}.
          </div>
        ) : (
          report.accounts.map((acc) => (
            <section className="ic" key={acc.account} style={{ marginBottom: 14 }}>
              <header className="ic__head">
                <span>{acc.account}</span>
                <span className="ic__head-meta tabnum">
                  {acc.tripCount} {acc.tripCount === 1 ? 'trip' : 'trips'} ·{' '}
                  <strong>{gbp(acc.totalPence)}</strong>
                </span>
              </header>
              <div className="ic__body">
                {acc.caseCodes.map((group) => (
                  <div key={group.caseCode ?? '—'} style={{ marginBottom: 10 }}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontWeight: 600,
                        fontSize: 12,
                        padding: '4px 0',
                        borderBottom: '1px solid var(--hairline-soft)',
                      }}
                    >
                      <span className="mono">
                        {group.caseCode ?? '— no case code'}
                        <span className="muted" style={{ fontWeight: 400 }}>
                          {' '}
                          · {group.tripCount} {group.tripCount === 1 ? 'trip' : 'trips'}
                        </span>
                      </span>
                      <span className="tabnum">{gbp(group.subtotalPence)}</span>
                    </div>
                    <table className="recon-table" style={{ width: '100%', fontSize: 12.5 }}>
                      <tbody>
                        {group.lines.map((line) => (
                          <tr key={line.seq}>
                            <td style={{ padding: '4px 8px 4px 0', whiteSpace: 'nowrap' }}>
                              {fmtLineDate(line.pickupAt)}
                            </td>
                            <td className="mono muted" style={{ padding: '4px 8px' }}>
                              {line.ref}
                            </td>
                            <td style={{ padding: '4px 8px' }}>{line.passenger}</td>
                            <td className="muted" style={{ padding: '4px 8px', width: '40%' }}>
                              {line.route}
                            </td>
                            <td
                              className="tabnum"
                              style={{
                                padding: '4px 0 4px 8px',
                                textAlign: 'right',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {gbp(line.totalPence)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </>
  );
}
