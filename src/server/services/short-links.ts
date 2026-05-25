import { randomBytes } from 'node:crypto';
import type { Database } from '@/server/db';
import { shortLinks } from '@/server/db/schema';
import { eq } from 'drizzle-orm';

// Unambiguous alphabet (no 0/O/1/l/I) so codes are easy to read/type aloud.
const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 7;
const MAX_ATTEMPTS = 5;

/** Random opaque short code, e.g. "Ab3xK7". */
export function generateShortCode(length = CODE_LENGTH): string {
  let out = '';
  for (const byte of randomBytes(length)) {
    out += ALPHABET[byte % ALPHABET.length];
  }
  return out;
}

/**
 * Persist a short link for `destination` (an absolute URL) and return its code.
 * Retries on the (vanishingly rare) primary-key collision.
 */
export async function createShortLink(db: Database, destination: string): Promise<string> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const code = generateShortCode();
    try {
      await db.insert(shortLinks).values({ code, destination });
      return code;
    } catch {
      // Code already taken — try another.
    }
  }
  throw new Error('could not allocate a unique short-link code');
}

/** Resolve a code to its destination URL, or null if unknown. */
export async function resolveShortLink(db: Database, code: string): Promise<string | null> {
  const [row] = await db
    .select({ destination: shortLinks.destination })
    .from(shortLinks)
    .where(eq(shortLinks.code, code))
    .limit(1);
  return row?.destination ?? null;
}
