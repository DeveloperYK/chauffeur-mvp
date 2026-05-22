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

/**
 * A controllable clock for tests that allows advancing time programmatically.
 * More flexible than fixedClock for scenarios that need time progression.
 */
export class TestClock implements Clock {
  private currentTime: Date;

  constructor(initialTime: Date | string | number = new Date()) {
    this.currentTime = initialTime instanceof Date ? new Date(initialTime) : new Date(initialTime);
  }

  now(): Date {
    return new Date(this.currentTime);
  }

  /**
   * Set the clock to an absolute time.
   */
  setTo(time: Date | string | number): void {
    this.currentTime = time instanceof Date ? new Date(time) : new Date(time);
  }

  /**
   * Advance the clock by a number of milliseconds.
   */
  advanceBy(ms: number): void {
    this.currentTime = new Date(this.currentTime.getTime() + ms);
  }

  /**
   * Advance the clock by hours.
   */
  advanceHours(hours: number): void {
    this.advanceBy(hours * 60 * 60 * 1000);
  }

  /**
   * Advance the clock by minutes.
   */
  advanceMinutes(minutes: number): void {
    this.advanceBy(minutes * 60 * 1000);
  }

  /**
   * Advance the clock by days.
   */
  advanceDays(days: number): void {
    this.advanceBy(days * 24 * 60 * 60 * 1000);
  }
}
