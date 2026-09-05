import { UNDO_CANCEL_WINDOW_MS, canUndoCancel } from '@/server/domain/undo-window';
import { describe, expect, it } from 'vitest';

const cancelledAt = new Date('2026-06-01T10:00:00.000Z');
const at = (ms: number) => new Date(cancelledAt.getTime() + ms);

describe('canUndoCancel', () => {
  // Happy paths.
  it('allows undo immediately after the cancel', () => {
    expect(canUndoCancel(cancelledAt, at(0))).toBe(true);
  });

  it('allows undo just inside the window', () => {
    expect(canUndoCancel(cancelledAt, at(UNDO_CANCEL_WINDOW_MS - 1))).toBe(true);
  });

  it('the window is one minute', () => {
    expect(UNDO_CANCEL_WINDOW_MS).toBe(60_000);
  });

  // Unhappy paths.
  it('refuses undo once the window has elapsed', () => {
    expect(canUndoCancel(cancelledAt, at(UNDO_CANCEL_WINDOW_MS))).toBe(false);
    expect(canUndoCancel(cancelledAt, at(UNDO_CANCEL_WINDOW_MS + 5_000))).toBe(false);
  });

  it('refuses undo when there is no cancel timestamp', () => {
    expect(canUndoCancel(null, at(0))).toBe(false);
  });

  it('refuses undo when the clock is behind the cancel (skewed)', () => {
    expect(canUndoCancel(cancelledAt, at(-1))).toBe(false);
  });
});
