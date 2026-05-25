import {
  createShortLink,
  generateShortCode,
  resolveShortLink,
} from '@/server/services/short-links';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestDb, createTestDb } from '~test/helpers/pglite-db';

describe('services/short-links', () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const t = await createTestDb();
    db = t.db;
    close = t.close;
  });
  afterAll(async () => {
    await close();
  });

  describe('generateShortCode', () => {
    it('produces a 7-char code from the unambiguous alphabet', () => {
      for (let i = 0; i < 50; i++) {
        const code = generateShortCode();
        expect(code).toMatch(/^[a-zA-Z0-9]{7}$/);
        // No ambiguous characters.
        expect(code).not.toMatch(/[0Ol1I]/);
      }
    });

    it('honours a custom length', () => {
      expect(generateShortCode(10)).toHaveLength(10);
    });
  });

  describe('create + resolve', () => {
    it('round-trips a destination through its code', async () => {
      const dest = 'https://chauffeur-mvp.vercel.app/j/some.signed.token';
      const code = await createShortLink(db, dest);
      expect(await resolveShortLink(db, code)).toBe(dest);
    });

    it('returns null for an unknown code', async () => {
      expect(await resolveShortLink(db, 'doesnotexist')).toBeNull();
    });

    it('mints distinct codes for distinct links', async () => {
      const a = await createShortLink(db, 'https://x/j/a');
      const b = await createShortLink(db, 'https://x/j/b');
      expect(a).not.toBe(b);
    });
  });
});
