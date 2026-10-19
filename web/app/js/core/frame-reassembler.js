/**
 * Rebuilds frames that arrive split across several notifications (small ATT MTU), using the
 * total-length byte at offset 1. The pieces of one frame arrive within milliseconds of each
 * other, so data left waiting for more than gapMs is dropped.
 */
export class FrameReassembler {
  #buffer = new Uint8Array(0);
  #lastMs = 0;

  constructor(gapMs = 300) {
    this.gapMs = gapMs;
  }

  /**
   * @param {Uint8Array} chunk
   * @param {number} timeMs
   * @returns {Uint8Array[]}
   */
  feed(chunk, timeMs) {
    if (this.#buffer.length > 0 && timeMs - this.#lastMs > this.gapMs) this.#buffer = new Uint8Array(0);
    this.#lastMs = timeMs;
    const joined = new Uint8Array(this.#buffer.length + chunk.length);
    joined.set(this.#buffer);
    joined.set(chunk, this.#buffer.length);
    this.#buffer = joined;

    const frames = [];
    while (this.#buffer.length >= 2) {
      const length = this.#buffer[1];
      if (length < 5) { // not a length byte: pass the data through as it is
        frames.push(this.#buffer);
        this.#buffer = new Uint8Array(0);
      } else if (this.#buffer.length >= length) {
        frames.push(this.#buffer.slice(0, length));
        this.#buffer = this.#buffer.slice(length);
      } else {
        break;
      }
    }
    return frames;
  }
}
