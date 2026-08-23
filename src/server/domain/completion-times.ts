import { addDaysToDayString, formatLondonDay, londonWallClockToUtc } from '@/lib/dates';

/**
 * Completion form captures three wall-clock times (HH:MM) — when the driver
 * arrived at the pickup, when the passenger was on board, and the drop-off —
 * plus a parking fee. The driver only types times of day; calendar dates are
 * inferred from the booking's pickup day, with day-rollover so a job that runs
 * past midnight (e.g. an 11pm pickup completing at 2am) is understood.
 *
 * The chargeable waiting time is DERIVED, not entered: passenger-on-board minus
 * the *later* of the booked pickup and the driver's actual arrival, floored at
 * zero. A driver arriving early doesn't start the clock sooner, and a driver
 * arriving late doesn't bill the client for their own lateness.
 */
export interface CompletionTimeInput {
  /** Driver arrived at the pickup, "HH:MM" (24h, Europe/London). */
  arrivalTime: string;
  /** Passenger on board, "HH:MM" (24h, Europe/London). */
  passengerOnBoardTime: string;
  /** Trip finished (drop-off), "HH:MM" (24h, Europe/London). */
  completionTime: string;
}

export interface ResolvedCompletionTimes {
  /** Driver's arrival at the pickup (stored as `arrival_at`). */
  arrivalAt: Date;
  /** Passenger on board (stored as `passenger_on_board_at`). */
  passengerOnBoardAt: Date;
  /** Trip completion (stored as `dropoff_at`). */
  dropoffAt: Date;
  /** Derived chargeable waiting: on-board − max(booked pickup, arrival), ≥ 0. */
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
 * Resolve the three times of day into absolute UTC instants:
 *
 * - The arrival is anchored to whichever London day (the pickup's, the one
 *   before, or the one after) puts it closest to the booked pickup — a driver
 *   arriving at 23:50 for a 00:30 pickup means the evening before, not 23h late.
 * - Boarding follows the arrival: same London day, rolling to the next when the
 *   clock time reads earlier than the arrival (boarded past midnight).
 * - The drop-off follows the boarding the same way.
 *
 * Each step is within 24h of the previous by construction; an on-board time
 * "before" the arrival therefore rolls a full day forward and trips the 12h
 * waiting cap — catching swapped/typo'd times as `waiting_too_long`.
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
  const dayBefore = addDaysToDayString(pickupDay, -1);
  const dayAfter = addDaysToDayString(pickupDay, 1);
  if (!dayBefore || !dayAfter) return { ok: false, reason: 'bad_format' };

  const onDay = (day: string, t: { hours: number; minutes: number }): Date => {
    const at = londonWallClockToUtc(day, t.hours, t.minutes);
    if (!at) throw new Error('unreachable: validated day + time failed to resolve');
    return at;
  };

  // Arrival: the candidate closest to the booked pickup.
  const arrivalAt = [dayBefore, pickupDay, dayAfter]
    .map((day) => onDay(day, arrival))
    .reduce((best, candidate) =>
      Math.abs(candidate.getTime() - pickupAt.getTime()) <
      Math.abs(best.getTime() - pickupAt.getTime())
        ? candidate
        : best,
    );

  // Boarding follows arrival; drop-off follows boarding — each rolls forward a
  // day when its clock time reads earlier than the instant it follows.
  const afterAnchor = (anchor: Date, t: { hours: number; minutes: number }): Date => {
    const anchorDay = formatLondonDay(anchor);
    let at = onDay(anchorDay, t);
    if (at.getTime() < anchor.getTime()) {
      const nextDay = addDaysToDayString(anchorDay, 1);
      if (!nextDay) throw new Error('unreachable: day arithmetic failed');
      at = onDay(nextDay, t);
    }
    return at;
  };

  const passengerOnBoardAt = afterAnchor(arrivalAt, onBoard);
  const dropoffAt = afterAnchor(passengerOnBoardAt, completion);

  // Chargeable waiting starts at the later of the booked pickup and the actual
  // arrival, so a late driver's lost time is never billed to the client.
  const waitingStartMs = Math.max(pickupAt.getTime(), arrivalAt.getTime());
  const waitingTimeMinutes = Math.max(
    0,
    Math.round((passengerOnBoardAt.getTime() - waitingStartMs) / 60_000),
  );
  if (waitingTimeMinutes > MAX_WAITING_MINUTES) return { ok: false, reason: 'waiting_too_long' };

  return { ok: true, arrivalAt, passengerOnBoardAt, dropoffAt, waitingTimeMinutes };
}
