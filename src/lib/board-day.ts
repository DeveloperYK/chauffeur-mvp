/**
 * Remember which day (and view mode) the operator last had open on the board,
 * so navigating away (Drivers, Invoicing…) and back doesn't reset to today.
 *
 * The value lives in sessionStorage keyed per tab. It carries the London day
 * it was saved on: a value saved yesterday is ignored, so the board always
 * opens on *today* at the start of a new working day.
 */

export const BOARD_QUERY_STORAGE_KEY = 'console.lastBoardQuery';

/** Query params that describe the board VIEW and are worth restoring. */
const VIEW_PARAMS = ['date', 'calMonth', 'layout', 'showDone'] as const;

/**
 * Reduce a board URL's search params to just the view params, in a stable
 * order. Transient state (open booking panel, create modal, search text,
 * assignee filter, saved view) is deliberately dropped.
 */
export function pickBoardParams(params: URLSearchParams): string {
  const kept = new URLSearchParams();
  for (const key of VIEW_PARAMS) {
    const value = params.get(key);
    if (value) kept.set(key, value);
  }
  return kept.toString();
}

/** Serialise a board query for storage, stamped with the London day. */
export function storedBoardQuery(qs: string, savedOn: string): string {
  return JSON.stringify({ qs, savedOn });
}

/**
 * Build the Board link href from a stored value. Falls back to the plain
 * board (today) when there is nothing stored, the value is corrupt, it was
 * saved on a previous day, or it contains nothing restorable.
 */
export function boardHrefFrom(stored: string | null, today: string): string {
  if (!stored) return '/dashboard';
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return '/dashboard';
  }
  if (typeof parsed !== 'object' || parsed === null) return '/dashboard';
  const { qs, savedOn } = parsed as { qs?: unknown; savedOn?: unknown };
  if (typeof qs !== 'string' || typeof savedOn !== 'string') return '/dashboard';
  if (savedOn !== today) return '/dashboard';
  // Re-filter through the allowlist so tampered storage can't inject params.
  const safe = pickBoardParams(new URLSearchParams(qs));
  return safe ? `/dashboard?${safe}` : '/dashboard';
}
