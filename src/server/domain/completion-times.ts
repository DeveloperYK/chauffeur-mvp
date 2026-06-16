import { addDaysToDayString, formatLondonDay, londonWallClockToUtc } from '@/lib/dates';

/**
 * Completion form captures three wall-clock times (HH:MM) plus a parking fee.
 * The driver only types times of day; the calendar date is inferred from the
 * booking's pickup day, with day-rollover so a job that runs past midnight
 * (e.g. an 11pm pickup completing at 2am) is understood without breaking.
 */
export interface CompletionTimeInput {
  /** Driver reached the pickup, "HH:MM" (24h, Europe/London). */
  arrivalTime: string;
  /** Passenger got in / journey started, "HH:MM". */
  passengerOnBoardTime: string;
  /** Trip finished (drop-off), "HH:MM". */
  completionTime: string;
}

export interface ResolvedCompletionTimes {
  arrivalAt: Date;
  passengerOnBoardAt: Date;
  /** Trip completion (stored as `dropoff_at`). */
  dropoffAt: Date;
  /** Derived: minutes from arrival to passenger-on-board. */
  waitingTimeMinutes: number;
}

export type ResolveCompletionTimesError = 'bad_format';

export type ResolveCompletionTimesResult =
  | ({ ok: true } & ResolvedCompletionTimes)
  | { ok: false; reason: ResolveCompletionTimesError };

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

function parseHhmm(value: string): { hours: number; minutes: number } | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match || match[1] === undefined || match[2] === undefined) return null;
  return { hours: Number(match[1]), minutes: Number(match[2]) };
}

/**
 * Turn the three time-of-day fields into absolute UTC instants, anchored to the
 * booking's London pickup day and chained forward so each event is at or after
 * the previous one:
 *
 * - Arrival is anchored to the pickup day, but shifted to the previous day if
 *   that would place it more than 12h after pickup (a time typed just before a
 *   just-after-midnight pickup).
 * - Passenger-on-board rolls to the next day if its clock time is before arrival.
 * - Completion rolls to the next day if its clock time is before on-board.
 *
 * Waiting time is derived as (on-board − arrival). The only failure is a
 * malformed time; spans are never rejected (the operator reviews completions).
 */
export function resolveCompletionTimes(
  pickupAt: Date,
  input: CompletionTimeInput,
): ResolveCompletionTimesResult {
  const arrival = parseHhmm(input.arrivalTime);
  const onBoard = parseHhmm(input.passengerOnBoardTime);
  const completion = parseHhmm(input.completionTime);
  if (!arrival || !onBoard || !completion) return { ok: false, reason: 'bad_format' };

  const pickupDay = formatLondonDay(pickupAt);
  const nextDay = addDaysToDayString(pickupDay, 1);
  const prevDay = addDaysToDayString(pickupDay, -1);
  if (!nextDay || !prevDay) return { ok: false, reason: 'bad_format' };

  const onDay = (day: string, t: { hours: number; minutes: number }): Date => {
    const at = londonWallClockToUtc(day, t.hours, t.minutes);
    if (!at) throw new Error('unreachable: validated day + time failed to resolve');
    return at;
  };

  let arrivalAt = onDay(pickupDay, arrival);
  if (arrivalAt.getTime() - pickupAt.getTime() > TWELVE_HOURS_MS) {
    arrivalAt = onDay(prevDay, arrival);
  }

  let passengerOnBoardAt = onDay(pickupDay, onBoard);
  if (passengerOnBoardAt.getTime() < arrivalAt.getTime()) {
    passengerOnBoardAt = onDay(nextDay, onBoard);
  }

  let dropoffAt = onDay(pickupDay, completion);
  if (dropoffAt.getTime() < passengerOnBoardAt.getTime()) {
    dropoffAt = onDay(nextDay, completion);
  }

  // No plausibility caps on the spans: the operator reviews every completion,
  // so we accept whatever the driver enters (even an out-of-order typo that
  // rolls into a long wait) and let review catch it, rather than blocking the
  // submission. Only a genuinely unparseable time is rejected, above.
  const waitingTimeMinutes = Math.round(
    (passengerOnBoardAt.getTime() - arrivalAt.getTime()) / 60_000,
  );

  return { ok: true, arrivalAt, passengerOnBoardAt, dropoffAt, waitingTimeMinutes };
}
