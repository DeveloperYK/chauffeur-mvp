const TZ = 'Europe/London';

/** "09:00" in Europe/London (midnight normalised to 00). */
export function mTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(new Date(iso))
    .replace(/^24/, '00');
}

/** "Tue 13 Oct" in Europe/London. */
export function mDay(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(iso));
}

/** "Tuesday 13 October 2026" in Europe/London. */
export function mDayLong(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(iso));
}

/** Hourly hire is sold in whole hours; transfers in minutes. */
export function mDuration(minutes: number, serviceType: 'transfer' | 'hourly'): string {
  if (serviceType === 'hourly') {
    const h = minutes / 60;
    return `${Number.isInteger(h) ? h : h.toFixed(1)} h as directed`;
  }
  return `${minutes} min`;
}
