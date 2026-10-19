export const DEFAULT_PRESETS = Object.freeze([3.0, 4.0, 5.0, 6.0]);
export const DEFAULT_TARGET_KMH = 2.0;

const PREFIX = 'pitpat.';

/**
 * Small persistent settings in the browser: the remembered treadmill, speed presets and options.
 * Storage can be missing or full (private browsing): settings then last until the page closes.
 */
export class Settings {
  #storage;
  /** @type {Map<string, string>} */
  #fallback = new Map();

  /** @param {Storage | null} storage */
  constructor(storage = defaultStorage()) {
    this.#storage = storage;
  }

  get deviceId() {
    return this.#get('deviceId');
  }

  get deviceName() {
    return this.#get('deviceName');
  }

  get protocolName() {
    return this.#get('protocol');
  }

  /**
   * @param {string} id
   * @param {string | null} name
   */
  saveDevice(id, name) {
    this.#set('deviceId', id);
    this.#set('deviceName', name);
  }

  /** @param {string} name */
  saveProtocol(name) {
    this.#set('protocol', name);
  }

  forgetDevice() {
    for (const key of ['deviceId', 'deviceName', 'protocol']) this.#set(key, null);
  }

  /** @returns {number[]} */
  get presets() {
    try {
      const values = JSON.parse(this.#get('presets') ?? 'null');
      if (Array.isArray(values) && values.length === DEFAULT_PRESETS.length && values.every(Number.isFinite)) return values;
    } catch {
      // fall through to the defaults
    }
    return [...DEFAULT_PRESETS];
  }

  set presets(values) {
    this.#set('presets', JSON.stringify(values));
  }

  get targetKmh() {
    const value = Number.parseFloat(this.#get('targetKmh') ?? '');
    return Number.isFinite(value) ? value : DEFAULT_TARGET_KMH;
  }

  set targetKmh(value) {
    if (value !== this.targetKmh) this.#set('targetKmh', String(value));
  }

  get keepAlive() {
    return this.#get('keepAlive') !== 'false';
  }

  set keepAlive(enabled) {
    this.#set('keepAlive', String(enabled));
  }

  /** @param {string} key */
  #get(key) {
    try {
      if (this.#storage) return this.#storage.getItem(PREFIX + key);
    } catch {
      // storage blocked: use the in-memory copy
    }
    return this.#fallback.get(key) ?? null;
  }

  /**
   * @param {string} key
   * @param {string | null} value
   */
  #set(key, value) {
    if (value === null) this.#fallback.delete(key);
    else this.#fallback.set(key, value);
    try {
      if (value === null) this.#storage?.removeItem(PREFIX + key);
      else this.#storage?.setItem(PREFIX + key, value);
    } catch {
      // storage blocked or full: the in-memory copy still works for this visit
    }
  }
}

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
