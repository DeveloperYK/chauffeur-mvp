import type {
  ExecNotificationStatus,
  NotificationChannel,
  NotificationStatus,
} from '@/server/db/schema';

/**
 * Pure roll-up of a booking's exec-message health into the single cached value
 * the board reads. Input is the latest non-superseded message per kind; output
 * is what `bookings.exec_notification_status` should be.
 *
 * Precedence is failure-first so a problem can never be hidden behind a later
 * healthy message of a different kind:
 *   failed   — any latest-per-kind message failed / bounced / complained
 *   pending  — otherwise, any email is accepted but not yet delivery-confirmed
 *   ok       — otherwise, everything sent (SMS) or delivered (email)
 *   none     — nothing sent yet
 */
export interface LatestMessage {
  channel: NotificationChannel;
  status: NotificationStatus;
}

type Health = 'ok' | 'pending' | 'failed';

function classify({ channel, status }: LatestMessage): Health {
  switch (status) {
    case 'delivered':
      return 'ok';
    case 'sent':
      // SMS has no delivery webhook, so "accepted" is the best signal we get and
      // counts as ok. An accepted email is only "pending" until its webhook lands.
      return channel === 'email' ? 'pending' : 'ok';
    case 'failed':
    case 'bounced':
    case 'complained':
      return 'failed';
    case 'superseded':
      // Superseded rows should be filtered out before this point; treat as
      // neutral if one slips through.
      return 'ok';
  }
}

export function rollupExecStatus(latestPerKind: LatestMessage[]): ExecNotificationStatus {
  if (latestPerKind.length === 0) return 'none';
  const states = latestPerKind.map(classify);
  if (states.includes('failed')) return 'failed';
  if (states.includes('pending')) return 'pending';
  return 'ok';
}
