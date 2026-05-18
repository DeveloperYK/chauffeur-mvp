import { hash, verify } from '@node-rs/argon2';

const PARAMS = {
  // OWASP 2024 recommendations for argon2id
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

export async function hashPassword(plain: string): Promise<string> {
  if (plain.length < 12) {
    throw new Error('password must be at least 12 characters');
  }
  return hash(plain, PARAMS);
}

export async function verifyPassword(plain: string, hashed: string): Promise<boolean> {
  try {
    return await verify(hashed, plain, PARAMS);
  } catch {
    return false;
  }
}
