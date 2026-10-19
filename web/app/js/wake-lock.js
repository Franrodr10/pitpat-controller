export const WakeLockStatus = Object.freeze({
  OFF: 'OFF',
  ON: 'ON',
  UNSUPPORTED: 'UNSUPPORTED',
  FAILED: 'FAILED',
});

/**
 * Keeps the screen on while wanted. Browsers drop the lock whenever the page is hidden, so it is
 * taken again each time the page comes back.
 */
export class ScreenWakeLock {
  #wanted = false;
  /** @type {any} */
  #sentinel = null;
  /** @type {string} */
  #status = WakeLockStatus.OFF;
  /** @type {Set<() => void>} */
  #listeners = new Set();

  constructor(doc = globalThis.document, nav = globalThis.navigator) {
    this.doc = doc;
    this.nav = nav;
    if (!this.supported) this.#status = WakeLockStatus.UNSUPPORTED;
    doc?.addEventListener('visibilitychange', () => {
      if (doc.visibilityState === 'visible') this.#acquire();
    });
  }

  get supported() {
    return typeof this.nav?.wakeLock?.request === 'function';
  }

  get status() {
    return this.#status;
  }

  /** @param {boolean} wanted */
  set(wanted) {
    if (wanted === this.#wanted) return;
    this.#wanted = wanted;
    if (wanted) {
      this.#acquire();
    } else {
      this.#sentinel?.release().catch(() => {});
      this.#sentinel = null;
      if (this.supported) this.#setStatus(WakeLockStatus.OFF);
    }
  }

  /** @param {() => void} listener */
  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async #acquire() {
    if (!this.#wanted || this.#sentinel || !this.supported || this.doc?.visibilityState !== 'visible') return;
    try {
      const sentinel = await this.nav.wakeLock.request('screen');
      if (!this.#wanted) {
        sentinel.release().catch(() => {});
        return;
      }
      this.#sentinel = sentinel;
      sentinel.addEventListener('release', () => {
        if (this.#sentinel === sentinel) this.#sentinel = null;
        if (this.#wanted && this.doc?.visibilityState === 'visible') this.#acquire();
        else if (!this.#wanted) this.#setStatus(WakeLockStatus.OFF);
      });
      this.#setStatus(WakeLockStatus.ON);
    } catch {
      this.#setStatus(WakeLockStatus.FAILED);
    }
  }

  /** @param {string} status */
  #setStatus(status) {
    if (status === this.#status) return;
    this.#status = status;
    for (const listener of this.#listeners) listener();
  }
}
