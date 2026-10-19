/** In-memory log of connection events and frames, shown in the app and shareable for debugging. */
export class DiagnosticsLog {
  /** @type {string[]} */
  #lines = [];
  /** @type {Set<() => void>} */
  #listeners = new Set();

  constructor(capacity = 3_000, now = () => new Date()) {
    this.capacity = capacity;
    this.now = now;
  }

  /** @param {string} message */
  add(message) {
    this.#lines.push(`${clock(this.now())}  ${message}`);
    if (this.#lines.length > this.capacity) this.#lines.splice(0, this.#lines.length - this.capacity);
    this.#notify();
  }

  snapshot() {
    return [...this.#lines];
  }

  clear() {
    this.#lines = [];
    this.#notify();
  }

  /** @param {() => void} listener */
  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #notify() {
    for (const listener of this.#listeners) listener();
  }
}

/** @param {Date} date HH:mm:ss.SSS */
function clock(date) {
  const two = (n) => String(n).padStart(2, '0');
  return `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}.${String(date.getMilliseconds()).padStart(3, '0')}`;
}
