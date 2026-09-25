/** Server time is the only time the system trusts (mockup Gate 2 step 1). Injectable for tests. */
export interface Clock {
  now(): Date;
}
export const systemClock: Clock = { now: () => new Date() };

export class FakeClock implements Clock {
  constructor(private t: Date = new Date('2026-09-25T02:00:00Z')) {}
  now() {
    return new Date(this.t);
  }
  advance(ms: number) {
    this.t = new Date(this.t.getTime() + ms);
  }
  set(d: Date) {
    this.t = new Date(d);
  }
}

export const DAY = 24 * 60 * 60 * 1000;
