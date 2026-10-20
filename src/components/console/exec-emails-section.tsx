'use client';

import type { ExecMessageEntry } from '@/app/(dashboard)/dashboard/console-actions';
import { type ExecEmailRow, execEmailRows } from './exec-email-due';
import { fmtTimeWithDay, relTime } from './format';
import { Icon } from './icons';
import { Lozenge } from './lozenge';
import type { ConsoleBooking } from './types';

/**
 * One card for everything the exec is told: the three manual emails the
 * operator sends (confirmation, driver details, booking update) and, folded
 * underneath them, the delivery history of every message that went out.
 *
 * The send rows and the history used to be two separate panel sections
 * ("Exec emails" / "Exec messages"); operators found the split confusing, so
 * they live together now. The history stays collapsed by default because it is
 * loaded on demand and is only needed when chasing a delivery problem.
 */

const FLAG_HINT: Record<ExecEmailRow['kind'], string> = {
  assigned: 'Driver assigned but the confirmation email hasn’t been sent.',
  en_route: 'The exec hasn’t had the driver details yet.',
  changed: 'The exec hasn’t been told about the confirmed change.',
};

const EXEC_KIND_LABEL: Record<ExecMessageEntry['kind'], string> = {
  assigned: 'Booking confirmation',
  en_route: 'Driver details',
  changed: 'Booking updated',
};

const EXEC_CHANNEL_LABEL: Record<ExecMessageEntry['channel'], string> = {
  sms: 'SMS',
  email: 'Email',
};

/** One-line summary shown next to the collapsed history toggle. */
export function execStatusMeta(status: ConsoleBooking['execNotificationStatus']): string {
  switch (status) {
    case 'failed':
      return '⚠ a message failed';
    case 'pending':
      return 'email pending';
    case 'ok':
      return 'all delivered';
    default:
      return 'none yet';
  }
}

/** Per-message status pill in the history. */
function ExecStatusLozenge({
  status,
  channel,
}: {
  status: ExecMessageEntry['status'];
  channel: ExecMessageEntry['channel'];
}) {
  const cfg = ((): { tone: 'gray' | 'green' | 'orange' | 'red'; label: string } => {
    switch (status) {
      case 'sent':
        return channel === 'email'
          ? { tone: 'orange', label: 'PENDING' }
          : { tone: 'green', label: 'SENT' };
      case 'delivered':
        return { tone: 'green', label: 'DELIVERED' };
      case 'failed':
        return { tone: 'red', label: 'FAILED' };
      case 'bounced':
        return { tone: 'red', label: 'BOUNCED' };
      case 'complained':
        return { tone: 'red', label: 'SPAM' };
      case 'superseded':
        return { tone: 'gray', label: 'SUPERSEDED' };
    }
  })();
  return <Lozenge tone={cfg.tone}>{cfg.label}</Lozenge>;
}

/** Status pill + timestamp for one send row: sent beats handled beats due. */
function EmailRowStatus({ row }: { row: ExecEmailRow }) {
  if (row.sentAt) {
    return (
      <>
        <Lozenge tone="green">SENT</Lozenge>
        <span className="muted" style={{ fontSize: 12 }}>
          {fmtTimeWithDay(row.sentAt)}
        </span>
      </>
    );
  }
  if (row.waivedAt) {
    return (
      <>
        <Lozenge tone="gray">HANDLED</Lozenge>
        <span className="muted" style={{ fontSize: 12 }}>
          {fmtTimeWithDay(row.waivedAt)}
        </span>
      </>
    );
  }
  if (row.flagged) return <Lozenge tone="orange">NOT SENT</Lozenge>;
  return (
    <span className="muted" style={{ fontSize: 12 }}>
      Not sent
    </span>
  );
}

function EmailRowView({
  row,
  isPending,
  onPreview,
  onWaive,
}: {
  row: ExecEmailRow;
  isPending: boolean;
  onPreview: (kind: ExecEmailRow['kind']) => void;
  onWaive: (kind: ExecEmailRow['kind'], waived: boolean) => void;
}) {
  return (
    <div className="ir">
      <div className="ir__k">{row.title}</div>
      <div className="ir__v">
        <div className="ir__row" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <EmailRowStatus row={row} />
          <span style={{ flex: 1 }} />
          {row.flagged ? (
            <button
              type="button"
              className="link-btn link-btn--muted"
              disabled={isPending}
              title="Clear this reminder — the exec was told another way, or the email is no longer needed"
              onClick={() => onWaive(row.kind, true)}
            >
              Mark as handled
            </button>
          ) : null}
          {row.waivedAt && !row.sentAt ? (
            <button
              type="button"
              className="link-btn link-btn--muted"
              disabled={isPending}
              onClick={() => onWaive(row.kind, false)}
            >
              Undo
            </button>
          ) : null}
          {row.canSend ? (
            <button
              type="button"
              className="link-btn"
              disabled={isPending}
              onClick={() => onPreview(row.kind)}
            >
              {row.sentAt ? 'Send again' : 'Preview & send'}
            </button>
          ) : row.disabledHint ? (
            <span className="muted" style={{ fontSize: 12 }}>
              {row.disabledHint}
            </span>
          ) : null}
        </div>
        {row.flagged ? (
          <div style={{ fontSize: 12, color: 'var(--prio-high)', marginTop: 2 }}>
            {FLAG_HINT[row.kind]}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MessageView({
  message,
  isPending,
  onResend,
}: {
  message: ExecMessageEntry;
  isPending: boolean;
  onResend: (id: string) => void;
}) {
  const isFailure =
    message.status === 'failed' || message.status === 'bounced' || message.status === 'complained';
  return (
    <div className="timeline__item">
      <span className={`timeline__dot ${isFailure ? '' : 'muted'}`} />
      <div className="timeline__body">
        <div className="ts">
          {fmtTimeWithDay(message.createdAt)} · {relTime(message.createdAt)}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="who">{EXEC_KIND_LABEL[message.kind]}</span>
          <span className="muted" style={{ fontSize: 11 }}>
            {EXEC_CHANNEL_LABEL[message.channel]}
          </span>
          <ExecStatusLozenge status={message.status} channel={message.channel} />
        </div>
        {message.to ? (
          <div className="muted mono" style={{ fontSize: 11, marginTop: 2 }}>
            To: {message.to}
            {message.cc.length > 0 ? ` · CC: ${message.cc.join(', ')}` : ''}
          </div>
        ) : null}
        <div className="muted" style={{ fontSize: 12, whiteSpace: 'pre-line', marginTop: 4 }}>
          {message.body}
        </div>
        {message.errorReason ? (
          <div style={{ fontSize: 12, color: 'var(--prio-high)', marginTop: 2 }}>
            Error: {message.errorReason}
          </div>
        ) : null}
        {isFailure ? (
          <button
            type="button"
            disabled={isPending}
            onClick={() => onResend(message.id)}
            style={{
              marginTop: 6,
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--prio-high)',
              background: 'none',
              border: '1px solid currentColor',
              borderRadius: 6,
              padding: '2px 10px',
              cursor: isPending ? 'default' : 'pointer',
            }}
          >
            {isPending ? 'Resending…' : 'Resend'}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function ExecEmailsSection({
  booking,
  isPending,
  onPreview,
  onWaive,
  history,
}: {
  booking: ConsoleBooking;
  isPending: boolean;
  onPreview: (kind: ExecEmailRow['kind']) => void;
  /** "Mark as handled" (true) or undo (false) for one email's reminder. */
  onWaive: (kind: ExecEmailRow['kind'], waived: boolean) => void;
  history: {
    open: boolean;
    loading: boolean;
    messages: ExecMessageEntry[] | null;
    onToggle: () => void;
    onResend: (id: string) => void;
  };
}) {
  const rows = execEmailRows(booking);
  return (
    <section className="ic ic--exec">
      <header className="ic__head">
        <span>Exec emails</span>
      </header>
      <div className="ic__body">
        {rows.map((r) => (
          <EmailRowView
            key={r.kind}
            row={r}
            isPending={isPending}
            onPreview={onPreview}
            onWaive={onWaive}
          />
        ))}
      </div>
      <button
        type="button"
        className="ic__head ic__head--toggle ic__head--sub"
        onClick={history.onToggle}
        aria-expanded={history.open}
      >
        <span>Message history</span>
        <span className="ic__head-meta">
          {execStatusMeta(booking.execNotificationStatus)}
          <Icon.ChevDown
            style={{
              width: 12,
              height: 12,
              marginLeft: 6,
              transform: history.open ? 'rotate(180deg)' : 'none',
              transition: 'transform 120ms ease',
            }}
          />
        </span>
      </button>
      {history.open ? (
        <div className="ic__body ic__body--history">
          {history.loading ? (
            <div className="muted" style={{ fontSize: 12 }}>
              Loading…
            </div>
          ) : history.messages && history.messages.length > 0 ? (
            <div className="timeline">
              {history.messages.map((m) => (
                <MessageView
                  key={m.id}
                  message={m}
                  isPending={isPending}
                  onResend={history.onResend}
                />
              ))}
            </div>
          ) : (
            <div className="muted" style={{ fontSize: 12 }}>
              No messages sent to the exec yet.
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
