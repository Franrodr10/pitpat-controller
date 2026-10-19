import { checksum } from '../../app/js/core/pitpat.js';

/**
 * A PitPat treadmill good enough for tests: it obeys the command frames of docs/PROTOCOL.md and
 * reports its state in 52-byte status frames. Steps are always 0, like on the PitPat-T01.
 * Runs in Node (manager tests) and in the browser (end-to-end tests).
 */
export class SimulatedTreadmill {
  state = 'STOPPED';
  speed = 0; // m/h, like the frames
  target = 0;
  distanceM = 0;
  durationMs = 0;
  countdownMs = 0;
  kcal = 0;
  maxSpeed = 6000;
  /** When true, a start command runs at 1 km/h whatever speed it asks for. */
  ignoresStartSpeed = false;
  /** @type {Uint8Array[]} */
  received = [];

  /** @param {Uint8Array} frame a frame written to FBA1 */
  receive(frame) {
    this.received.push(frame);
    if (frame[0] !== 0x6a || frame.length !== 23) return; // keep-alive and anything else
    const speed = frame[6] * 256 + frame[7];
    const mode = frame[8];
    const op = frame[12];
    if (op === 0x00) {
      this.state = 'STOPPED';
      this.speed = 0;
    } else if (op === 0x02 && this.state === 'RUNNING') {
      this.state = 'PAUSED';
      this.speed = 0;
    } else if (op === 0x04 && mode === 1 && (this.state === 'STOPPED' || this.state === 'PAUSED')) {
      if (this.state === 'STOPPED') {
        this.distanceM = 0;
        this.durationMs = 0;
        this.kcal = 0;
      }
      this.state = 'STARTING';
      this.countdownMs = 3_000;
      this.target = this.ignoresStartSpeed ? 1000 : Math.min(speed, this.maxSpeed);
    } else if (op === 0x04 && mode === 5 && this.state === 'RUNNING') {
      this.target = Math.min(speed, this.maxSpeed);
    }
  }

  /** @param {number} ms */
  tick(ms) {
    if (this.state === 'STARTING') {
      this.countdownMs -= ms;
      if (this.countdownMs <= 0) {
        this.state = 'RUNNING';
        this.speed = 1000;
      }
    } else if (this.state === 'RUNNING') {
      const step = 500 * (ms / 1000); // accelerates or brakes 0.5 km/h per second
      this.speed = this.speed < this.target ? Math.min(this.target, this.speed + step) : Math.max(this.target, this.speed - step);
      this.distanceM += (this.speed / 3_600_000) * ms;
      this.durationMs += ms;
      this.kcal = Math.floor(this.distanceM / 20);
    }
    return this;
  }

  statusFrame() {
    const flags = { STOPPED: 0x00, STARTING: 0x18, RUNNING: 0x08, PAUSED: 0x10 }[this.state];
    const frame = new Uint8Array(52);
    frame[0] = 0x68;
    frame[1] = frame.length;
    put(frame, 3, Math.round(this.speed), 2);
    put(frame, 5, this.target, 2);
    put(frame, 7, Math.floor(this.distanceM), 4);
    put(frame, 18, this.kcal, 2);
    put(frame, 20, this.durationMs, 4);
    frame[25] = 27; // firmware: duration in milliseconds
    frame[26] = flags;
    put(frame, 27, this.maxSpeed, 2);
    frame[50] = checksum(frame);
    frame[51] = 0x43;
    return frame;
  }
}

function put(frame, offset, value, size) {
  for (let i = 0; i < size; i++) frame[offset + i] = Math.floor(value / 256 ** (size - 1 - i)) & 0xff;
}
