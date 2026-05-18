import { hashPassword, verifyPassword } from '@/server/auth/password';
import { describe, expect, it } from 'vitest';

describe('password', () => {
  it('hashes and verifies a strong password', async () => {
    const hash = await hashPassword('super-secret-password');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword('super-secret-password', hash)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('super-secret-password');
    expect(await verifyPassword('wrong-password-here', hash)).toBe(false);
  });

  it('rejects passwords shorter than 12 chars', async () => {
    await expect(hashPassword('short')).rejects.toThrow(/12 characters/);
  });

  it('returns false for malformed hash input', async () => {
    expect(await verifyPassword('whatever-12chars', 'not-a-real-hash')).toBe(false);
  });
});
