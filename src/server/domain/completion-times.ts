import { addDaysToDayString, formatLondonDay, londonWallClockToUtc } from '@/lib/dates';

/**
 * Completion form captures the minutes the driver waited for the passenger, the
 * drop-off wall-clock time (HH:MM) and a parking fee. The driver only types a
 * time of day; the calendar date is inferred from the booking's pickup day,
 * with day-rollover so a job that runs past midnight (e.g. an 11pm pickup
 * completing at 2am) is understood without breaking.
 */
export interface CompletionTimeInput {
  /** Minutes the driver waited for the passenger (0 when they were on time). */
  waitingMinutes: number;
  /** Trip finished (drop-off), "HH:MM" (24h, Europe/London). */
  completionTime: string;
}

export interface ResolvedCompletionTimes {
  /** Trip completion (stored as `dropoff_at`). */
  dropoffAt: Date;
  /** Minutes waited, as reported by the driver. */
  waitingTimeMinutes: number;
}

export type ResolveCompletionTimesError = 'bad_format' | 'waiting_too_long';

export type ResolveCompletionTimesResult =
  | ({ ok: true } & ResolvedCompletionTimes)
  | { ok: false; reason: ResolveCompletionTimesError };

const MAX_WAITING_MINUTES = 720; // 12h — matches the old manual waiting cap.

function parseHhmm(value: string): { hours: number; minutes: number } | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match || match[1] === undefined || match[2] === undefined) return null;
  return { hours: Number(match[1]), minutes: Number(match[2]) };
}

/**
 * Turn the drop-off time-of-day into an absolute UTC instant, anchored to the
 * booking's London pickup day: a clock time earlier than the pickup means the
 * job ran past midnight, so it rolls to the next day. The rollover keeps every
 * drop-off within 24h of pickup by construction. Waiting minutes are validated
 * and passed through (they drive the £1/min charge). Returns an error for a
 * malformed time or an implausibly long wait (likely a typo).
 */
export function resolveCompletionTimes(
  pickupAt: Date,
  input: CompletionTimeInput,
): ResolveCompletionTimesResult {
  const completion = parseHhmm(input.completionTime);
  if (!completion) return { ok: false, reason: 'bad_format' };
  const waitingTimeMinutes = input.waitingMinutes;
  if (!Number.isInteger(waitingTimeMinutes) || waitingTimeMinutes < 0) {
    return { ok: false, reason: 'bad_format' };
  }
  if (waitingTimeMinutes > MAX_WAITING_MINUTES) return { ok: false, reason: 'waiting_too_long' };

  const pickupDay = formatLondonDay(pickupAt);
  const nextDay = addDaysToDayString(pickupDay, 1);
  if (!nextDay) return { ok: false, reason: 'bad_format' };

  const onDay = (day: string, t: { hours: number; minutes: number }): Date => {
    const at = londonWallClockToUtc(day, t.hours, t.minutes);
    if (!at) throw new Error('unreachable: validated day + time failed to resolve');
    return at;
  };

  let dropoffAt = onDay(pickupDay, completion);
  if (dropoffAt.getTime() < pickupAt.getTime()) {
    dropoffAt = onDay(nextDay, completion);
  }

  return { ok: true, dropoffAt, waitingTimeMinutes };
}
