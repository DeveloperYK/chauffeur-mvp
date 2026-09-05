import { boardHrefFrom, pickBoardParams, storedBoardQuery } from '@/lib/board-day';
import { describe, expect, it } from 'vitest';

describe('lib/board-day', () => {
  describe('pickBoardParams', () => {
    it('keeps the view params (date, calMonth, layout, showDone)', () => {
      const qs = pickBoardParams(
        new URLSearchParams('date=2026-09-10&calMonth=2026-09&layout=board&showDone=0'),
      );
      expect(qs).toBe('date=2026-09-10&calMonth=2026-09&layout=board&showDone=0');
    });

    it('drops transient params (booking panel, create modal, search, filters, saved view)', () => {
      const qs = pickBoardParams(
        new URLSearchParams(
          'date=2026-09-10&booking=abc&new=1&q=smith&assignee=x&savedView=unassigned',
        ),
      );
      expect(qs).toBe('date=2026-09-10');
    });

    it('returns an empty string when nothing view-related is set', () => {
      expect(pickBoardParams(new URLSearchParams('booking=abc&q=smith'))).toBe('');
      expect(pickBoardParams(new URLSearchParams())).toBe('');
    });
  });

  describe('storedBoardQuery / boardHrefFrom round trip', () => {
    it('restores the stored day when saved on the same London day', () => {
      const stored = storedBoardQuery('date=2026-09-10&layout=board', '2026-09-04');
      expect(boardHrefFrom(stored, '2026-09-04')).toBe('/dashboard?date=2026-09-10&layout=board');
    });

    it('falls back to the plain board when the stored value is from a previous day', () => {
      const stored = storedBoardQuery('date=2026-09-10', '2026-09-03');
      expect(boardHrefFrom(stored, '2026-09-04')).toBe('/dashboard');
    });

    it('falls back to the plain board when nothing is stored', () => {
      expect(boardHrefFrom(null, '2026-09-04')).toBe('/dashboard');
    });

    it('falls back to the plain board on corrupt storage (not JSON, wrong shape)', () => {
      expect(boardHrefFrom('not-json{', '2026-09-04')).toBe('/dashboard');
      expect(boardHrefFrom(JSON.stringify({ nope: true }), '2026-09-04')).toBe('/dashboard');
      expect(boardHrefFrom(JSON.stringify({ qs: 42, savedOn: '2026-09-04' }), '2026-09-04')).toBe(
        '/dashboard',
      );
    });

    it('never restores params outside the view allowlist even if storage was tampered with', () => {
      const stored = JSON.stringify({
        qs: 'date=2026-09-10&new=1&booking=abc',
        savedOn: '2026-09-04',
      });
      expect(boardHrefFrom(stored, '2026-09-04')).toBe('/dashboard?date=2026-09-10');
    });

    it('falls back to the plain board when the stored query is empty', () => {
      const stored = storedBoardQuery('', '2026-09-04');
      expect(boardHrefFrom(stored, '2026-09-04')).toBe('/dashboard');
    });
  });
});
