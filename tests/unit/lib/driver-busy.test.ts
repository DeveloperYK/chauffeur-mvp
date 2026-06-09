import { BUSY_BUFFER_MS, firstClashingWindow } from '@/lib/driver-busy';
import { describe, expect, it } from 'vitest';

const MIN = 60_000;
// Candidate pickup window: 18:00–19:00 (arbitrary epoch base).
const CAND_START = 1_800_000_000_000;
const CAND_END = CAND_START + 60 * MIN;

describe('firstClashingWindow (30-min busy buffer)', () => {
  it('flags a window that directly overlaps the candidate', () => {
    const w = { startMs: CAND_START + 30 * MIN, endMs: CAND_START + 90 * MIN };
    expect(firstClashingWindow([w], CAND_START, CAND_END)).toEqual(w);
  });

  it('flags a window ending 29 min before the candidate starts (within buffer)', () => {
    const w = { startMs: CAND_START - 90 * MIN, endMs: CAND_START - 29 * MIN };
    expect(firstClashingWindow([w], CAND_START, CAND_END)).toEqual(w);
  });

  it('flags a window starting 29 min after the candidate ends (within buffer)', () => {
    const w = { startMs: CAND_END + 29 * MIN, endMs: CAND_END + 90 * MIN };
    expect(firstClashingWindow([w], CAND_START, CAND_END)).toEqual(w);
  });

  it('flags a back-to-back window (ends exactly when candidate starts)', () => {
    const w = { startMs: CAND_START - 60 * MIN, endMs: CAND_START };
    expect(firstClashingWindow([w], CAND_START, CAND_END)).toEqual(w);
  });

  it('does NOT flag a window ending 31 min before the candidate (outside buffer)', () => {
    const w = { startMs: CAND_START - 90 * MIN, endMs: CAND_START - 31 * MIN };
    expect(firstClashingWindow([w], CAND_START, CAND_END)).toBeNull();
  });

  it('does NOT flag a window starting 31 min after the candidate ends (outside buffer)', () => {
    const w = { startMs: CAND_END + 31 * MIN, endMs: CAND_END + 90 * MIN };
    expect(firstClashingWindow([w], CAND_START, CAND_END)).toBeNull();
  });

  it('returns null for no windows', () => {
    expect(firstClashingWindow([], CAND_START, CAND_END)).toBeNull();
  });

  it('returns the earliest-starting clashing window when several clash', () => {
    const later = { startMs: CAND_START + 10 * MIN, endMs: CAND_START + 70 * MIN };
    const earlier = { startMs: CAND_START - 20 * MIN, endMs: CAND_START + 20 * MIN };
    expect(firstClashingWindow([later, earlier], CAND_START, CAND_END)).toEqual(earlier);
  });

  it('exposes a 30-minute buffer constant', () => {
    expect(BUSY_BUFFER_MS).toBe(30 * MIN);
  });
});
