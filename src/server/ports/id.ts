import { randomUUID } from 'node:crypto';

export interface IdGenerator {
  uuid(): string;
}

export const cryptoIdGenerator: IdGenerator = {
  uuid: () => randomUUID(),
};

/** Deterministic generator for tests. */
export function sequentialIdGenerator(prefix = '00000000-0000-0000-0000-'): IdGenerator {
  let i = 0;
  return {
    uuid: () => {
      i += 1;
      return `${prefix}${i.toString(16).padStart(12, '0')}`;
    },
  };
}
