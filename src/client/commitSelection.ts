export interface SelectionTimers {
  now: () => number;
  setTimeout: (callback: () => void, delay: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

const timers: SelectionTimers = {
  now: () => performance.now(),
  setTimeout: (callback, delay) => setTimeout(callback, delay),
  clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class CommitSelection {
  private value: string | null | undefined;
  private lastChange = -Infinity;
  private pending: unknown;

  constructor(private readonly publish: (value: string | null) => void, private readonly clock = timers, private readonly delay = 100) {}

  select(value: string | null) {
    if (value === this.value) return;
    this.value = value;
    if (this.pending !== undefined) this.clock.clearTimeout(this.pending);
    this.pending = undefined;
    const now = this.clock.now();
    const immediate = value === null || now - this.lastChange >= this.delay;
    this.lastChange = now;
    if (immediate) this.publish(value);
    else {
      this.publish(null);
      this.pending = this.clock.setTimeout(() => {
        this.pending = undefined;
        this.publish(value);
      }, this.delay);
    }
  }

  cancel() {
    if (this.pending !== undefined) this.clock.clearTimeout(this.pending);
    this.pending = undefined;
    this.value = undefined;
    this.lastChange = -Infinity;
  }
}
