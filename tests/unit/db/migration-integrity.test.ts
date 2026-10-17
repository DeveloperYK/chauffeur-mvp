import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { checkMigrationIntegrity } from '@/server/db/migration-integrity';
import { describe, expect, it } from 'vitest';

/**
 * Migrations are hand-authored (ADR 0022, drizzle-kit generate is unusable)
 * and several sessions branch from main at once. Two branches have already
 * picked the same migration number, and a journal entry whose `when` does not
 * exceed the previous one is silently skipped by the migrator in a shared
 * local DB while PGlite tests keep passing. This check turns both into a
 * failing test on the branch that introduces them (ADR 0024).
 */
const entry = (idx: number, tag: string, when: number) => ({ idx, tag, when });

const GOOD_FILES = ['0000_init.sql', '0001_add_drivers.sql', '0002_add_bookings.sql'];
const GOOD_JOURNAL = [
  entry(0, '0000_init', 1_000),
  entry(1, '0001_add_drivers', 2_000),
  entry(2, '0002_add_bookings', 3_000),
];

describe('checkMigrationIntegrity', () => {
  describe('happy paths', () => {
    it('accepts a consistent, sequential journal', () => {
      expect(checkMigrationIntegrity(GOOD_FILES, GOOD_JOURNAL)).toEqual({ ok: true, issues: [] });
    });

    it('accepts an empty migrations folder', () => {
      expect(checkMigrationIntegrity([], [])).toEqual({ ok: true, issues: [] });
    });

    it('ignores non-SQL files in the folder', () => {
      const files = [...GOOD_FILES, 'meta', 'README.md'];
      expect(checkMigrationIntegrity(files, GOOD_JOURNAL).ok).toBe(true);
    });

    it('does not depend on the order files are listed in', () => {
      const shuffled = [GOOD_FILES[2], GOOD_FILES[0], GOOD_FILES[1]] as string[];
      expect(checkMigrationIntegrity(shuffled, GOOD_JOURNAL).ok).toBe(true);
    });
  });

  describe('unhappy paths', () => {
    it('flags a SQL file with no journal entry', () => {
      const result = checkMigrationIntegrity([...GOOD_FILES, '0003_orphan.sql'], GOOD_JOURNAL);
      expect(result.ok).toBe(false);
      expect(result.issues).toEqual([
        expect.stringContaining('0003_orphan.sql has no journal entry'),
      ]);
    });

    it('flags a journal entry with no SQL file', () => {
      const journal = [...GOOD_JOURNAL, entry(3, '0003_ghost', 4_000)];
      const result = checkMigrationIntegrity(GOOD_FILES, journal);
      expect(result.ok).toBe(false);
      expect(result.issues).toEqual([expect.stringContaining('0003_ghost has no SQL file')]);
    });

    it('flags two SQL files sharing a migration number (parallel-branch collision)', () => {
      const files = [...GOOD_FILES, '0003_feature_a.sql', '0003_feature_b.sql'];
      const journal = [
        ...GOOD_JOURNAL,
        entry(3, '0003_feature_a', 4_000),
        entry(4, '0003_feature_b', 5_000),
      ];
      const result = checkMigrationIntegrity(files, journal);
      expect(result.ok).toBe(false);
      expect(result.issues.join('\n')).toContain('number 0003 is used by 2 files');
    });

    it('flags a journal idx that does not match its position', () => {
      const journal = [
        GOOD_JOURNAL[0],
        GOOD_JOURNAL[1],
        entry(5, '0002_add_bookings', 3_000),
      ] as typeof GOOD_JOURNAL;
      const result = checkMigrationIntegrity(GOOD_FILES, journal);
      expect(result.ok).toBe(false);
      expect(result.issues.join('\n')).toContain('idx 5 at position 2');
    });

    it('flags a journal tag whose number prefix disagrees with its idx', () => {
      const files = ['0000_init.sql', '0001_add_drivers.sql', '0007_add_bookings.sql'];
      const journal = [
        GOOD_JOURNAL[0],
        GOOD_JOURNAL[1],
        entry(2, '0007_add_bookings', 3_000),
      ] as typeof GOOD_JOURNAL;
      const result = checkMigrationIntegrity(files, journal);
      expect(result.ok).toBe(false);
      expect(result.issues.join('\n')).toContain('0007_add_bookings is at idx 2');
    });

    it('flags a `when` that does not strictly increase (migrator would skip it)', () => {
      const journal = [
        GOOD_JOURNAL[0],
        GOOD_JOURNAL[1],
        entry(2, '0002_add_bookings', 2_000),
      ] as typeof GOOD_JOURNAL;
      const result = checkMigrationIntegrity(GOOD_FILES, journal);
      expect(result.ok).toBe(false);
      expect(result.issues.join('\n')).toContain(
        '`when` 2000 is not greater than the previous entry',
      );
    });

    it('flags a journal entry whose tag is not a zero-padded number prefix', () => {
      const result = checkMigrationIntegrity(['init.sql'], [entry(0, 'init', 1_000)]);
      expect(result.ok).toBe(false);
      expect(result.issues.join('\n')).toContain('tag init is not of the form NNNN_name');
    });

    it('reports every issue at once rather than stopping at the first', () => {
      const result = checkMigrationIntegrity(
        [...GOOD_FILES, '0003_orphan.sql'],
        [...GOOD_JOURNAL, entry(4, '0004_ghost', 2_500)],
      );
      expect(result.issues.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('the real drizzle/ folder', () => {
    const dir = join(process.cwd(), 'drizzle');
    const journal = JSON.parse(readFileSync(join(dir, 'meta', '_journal.json'), 'utf8')) as {
      entries: ReadonlyArray<{ idx: number; tag: string; when: number }>;
    };

    it('is internally consistent', () => {
      expect(checkMigrationIntegrity(readdirSync(dir), journal.entries)).toEqual({
        ok: true,
        issues: [],
      });
    });
  });
});
