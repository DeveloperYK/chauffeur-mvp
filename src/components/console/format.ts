import type { ConsoleBooking } from './types';

// Display helpers for the console overlays. Times render in Europe/London to
// match the rest of the operator dashboard.

const TZ = 'Europe/London';

export function fmtTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

export function fmtTimeWithDay(iso: string): string {
  const d = new Date(iso);
  const dayKey = (x: Date) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(x);
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 3600_000);
  const time = fmtTime(iso);
  if (dayKey(d) === dayKey(now)) return `Today ${time}`;
  if (dayKey(d) === dayKey(tomorrow)) return `Tomorrow ${time}`;
  const dayLabel = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(d);
  return `${dayLabel} ${time}`;
}

export function relTime(iso: string): string {
  const diff = (new Date(iso).getTime() - Date.now()) / 60_000;
  const abs = Math.abs(diff);
  const future = diff >= 0;
  if (abs < 1) return future ? 'now' : 'moments ago';
  if (abs < 60) return future ? `in ${Math.round(abs)} min` : `${Math.round(abs)} min ago`;
  if (abs < 60 * 24)
    return future ? `in ${Math.round(abs / 60)} h` : `${Math.round(abs / 60)} h ago`;
  return future ? `in ${Math.round(abs / 60 / 24)} d` : `${Math.round(abs / 60 / 24)} d ago`;
}

export function fmtPrice(pence: number | null): string {
  if (pence == null) return '—';
  return `£${(pence / 100).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function truncate(s: string, n: number): string {
  return s && s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export function passengerName(
  b: Pick<ConsoleBooking, 'passengerFirstName' | 'passengerLastName'>,
): string {
  return `${b.passengerFirstName}${b.passengerLastName ? ` ${b.passengerLastName}` : ''}`;
}

/**
 * Europe/London wall-clock parts of an instant. Explicitly TZ'd (not the
 * browser's local zone) so edit/completion pre-fills are correct wherever the
 * operator is, and round-trip cleanly with the server's Europe/London pickup
 * parse (lib/dates.parsePickupInput).
 */
function londonInputParts(iso: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? '';
  // `hour12: false` can render midnight as "24"; a datetime-local needs 00–23.
  const hour = get('hour') === '24' ? '00' : get('hour');
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${hour}:${get('minute')}`,
  };
}

/** Convert a UTC ISO timestamp to the value a datetime-local input expects (Europe/London). */
export function toLocalDateTimeInput(iso: string): string {
  const { date, time } = londonInputParts(iso);
  return `${date}T${time}`;
}

/** Format an ISO instant as "HH:MM" in Europe/London (BST-aware). */
export function toLocalTimeInput(iso: string): string {
  return londonInputParts(iso).time;
}

export const VEHICLE_SUGGESTIONS = [
  'Mercedes S-Class',
  'Mercedes E-Class',
  'BMW 7 Series',
  'Range Rover',
  'Mercedes V-Class MPV',
];
