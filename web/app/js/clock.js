/**
 * Time for the connection logic, behind an interface so tests can run it on a fake clock.
 *
 * @typedef {object} Clock
 * @property {() => number} now Monotonic milliseconds.
 * @property {(ms: number, signal?: AbortSignal) => Promise<void>} sleep Resolves after ms, or as
 *   soon as signal aborts.
 */

/** @type {Clock} */
export const systemClock = {
  now: () => performance.now(),
  sleep: (ms, signal) => new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  }),
};
