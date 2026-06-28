import { toLocalDateTimeInput, toLocalTimeInput } from '@/components/console/format';
import { describe, expect, it } from 'vitest';

// These format a stored UTC instant into the value a `datetime-local` / `time`
// input expects, in Europe/London — explicitly, not via the browser's local
// zone. That keeps the edit/completion pre-fills correct regardless of where the
// operator's browser is, and makes them round-trip cleanly with the server's
// Europe/London pickup parse (see lib/dates.parsePickupInput).

describe('toLocalDateTimeInput', () => {
  it('renders a summer (BST) instant as London wall-clock (+1h)', () => {
    expect(toLocalDateTimeInput('2026-07-01T09:30:00.000Z')).toBe('2026-07-01T10:30');
  });

  it('renders a winter (GMT) instant unchanged', () => {
    expect(toLocalDateTimeInput('2026-01-01T10:30:00.000Z')).toBe('2026-01-01T10:30');
  });

  it('round-trips a London-midnight-adjacent instant within the same London day', () => {
    // 2026-06-30T23:30Z is 00:30 on 1 Jul in London (BST).
    expect(toLocalDateTimeInput('2026-06-30T23:30:00.000Z')).toBe('2026-07-01T00:30');
  });
});

describe('toLocalTimeInput', () => {
  it('renders a summer (BST) instant as London time-of-day (+1h)', () => {
    expect(toLocalTimeInput('2026-07-01T09:30:00.000Z')).toBe('10:30');
  });

  it('renders a winter (GMT) instant unchanged', () => {
    expect(toLocalTimeInput('2026-01-01T08:05:00.000Z')).toBe('08:05');
  });
});
