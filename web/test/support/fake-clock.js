/** A clock for the connection logic that only moves when a test calls advance(). */
export class FakeClock {
  t = 0;
  /** @type {{due: number, resolve: () => void}[]} */
  #timers = [];

  now = () => this.t;

  /**
   * @param {number} ms
   * @param {AbortSignal} [signal]
   */
  sleep = (ms, signal) => new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = { due: this.t + ms, resolve: () => {} };
    const done = () => {
      this.#timers = this.#timers.filter((other) => other !== timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    timer.resolve = done;
    this.#timers.push(timer);
    signal?.addEventListener('abort', done, { once: true });
  });

  /** Runs every timer due within ms, in order, letting promises settle in between. */
  async advance(ms) {
    const end = this.t + ms;
    for (;;) {
      await settle();
      const next = this.#timers.reduce((first, timer) => (first === null || timer.due < first.due ? timer : first), null);
      if (next === null || next.due > end) break;
      this.t = next.due;
      next.resolve();
    }
    this.t = end;
    await settle();
  }
}

/** Lets every pending promise callback run. */
export const settle = () => new Promise((resolve) => setImmediate(resolve));
