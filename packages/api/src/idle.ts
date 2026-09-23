/// A stream that has gone quiet looks exactly like a stream that is still
/// working, so the read that never returns gets a deadline of its own. The abort
/// it fires is the one the request was made with, so a watchdog that expires
/// stops the request instead of only walking away from it, and the caller can
/// tell its own cancellation from this one because only this one is remembered.

export class IdleWatchdog {
  private readonly timeout_ms: number;
  private timer: NodeJS.Timeout | null = null;
  private expired = false;
  private readonly controller = new AbortController();

  constructor(timeout_ms: number) {
    this.timeout_ms = timeout_ms;
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  get timedOut(): boolean {
    return this.expired;
  }

  /// Armed around one outstanding wait and disarmed by it, so the deadline is
  /// the silence between two pieces of work rather than the work itself.
  async guard<T>(work: () => Promise<T>): Promise<T> {
    this.arm();
    try {
      return await work();
    } finally {
      this.disarm();
    }
  }

  stop(): void {
    this.disarm();
  }

  private arm(): void {
    this.disarm();
    if (this.timeout_ms <= 0 || this.expired) return;
    this.timer = setTimeout(() => {
      this.expired = true;
      this.controller.abort();
    }, this.timeout_ms);
  }

  private disarm(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }
}
