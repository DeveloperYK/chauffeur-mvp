import { UNDO_CANCEL_WINDOW_MS } from '@/lib/undo-window';

export { UNDO_CANCEL_WINDOW_MS };

/**
 * Whether a cancel made at `cancelledAt` can still be undone at `now`.
 * Enforced on the server against the booking's `cancelledAt` — the toast
 * countdown in the console is only a courtesy.
 */
export function canUndoCancel(cancelledAt: Date | null | undefined, now: Date): boolean {
  if (!cancelledAt) return false;
  const elapsed = now.getTime() - cancelledAt.getTime();
  return elapsed >= 0 && elapsed < UNDO_CANCEL_WINDOW_MS;
}
