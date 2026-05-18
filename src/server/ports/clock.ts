export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export function fixedClock(at: Date | string | number): Clock {
  const t = at instanceof Date ? at : new Date(at);
  return { now: () => t };
}
