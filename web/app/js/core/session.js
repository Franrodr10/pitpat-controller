import { RunState, isMoving } from './protocol.js';
import { CommandKind } from './scheduler.js';

export const Notice = Object.freeze({
  NOT_CONNECTED: 'NOT_CONNECTED',
  NO_DATA: 'NO_DATA',
  STOP_NOT_CONFIRMED: 'STOP_NOT_CONFIRMED',
});

export const FRESH_MS = 3_000;
export const LOCAL_CHANGE_HOLD_MS = 2_000;
export const PENDING_START_TIMEOUT_MS = 15_000;
export const STOP_CHECK_MS = 3_000;
export const MAX_STOP_RESENDS = 2;
const SPEED_TOLERANCE_KMH = 0.05;

/**
 * @typedef {import('./protocol.js').TreadmillProtocol} TreadmillProtocol
 * @typedef {import('./protocol.js').TreadmillStatus} TreadmillStatus
 * @typedef {import('./scheduler.js').Command} Command
 * @typedef {{commands: Command[], notice: string | null}} Outcome
 */

/**
 * @param {Command[]} [commands]
 * @param {string | null} [notice] one of Notice
 * @returns {Outcome}
 */
const outcome = (commands = [], notice = null) => ({ commands, notice });

/**
 * Turns user actions and treadmill status into commands, enforcing the safety rules:
 *
 * - speeds are rounded to 0.1 km/h and clamped to the protocol range and the treadmill's maximum;
 * - speed changes are only sent while the belt runs and the status is fresh;
 * - STOP is always sent when connected, and re-sent if the belt keeps moving;
 * - nothing is sent on its own after a reconnection: the link going down clears pending work.
 *
 * Same rules as SessionController.kt in the Android app.
 */
export class SessionController {
  /** @type {TreadmillStatus | null} */
  #status = null;
  #statusAtMs = 0;
  /** @type {number | null} */
  #pendingStartKmh = null;
  #pendingStartAtMs = 0;
  /** @type {number | null} */
  #localChangeAtMs = null;
  /** @type {number | null} */
  #stopSentAtMs = null;
  #stopResends = 0;
  #targetKmh;

  /**
   * @param {TreadmillProtocol} protocol
   * @param {number} initialTargetKmh
   */
  constructor(protocol, initialTargetKmh) {
    this.protocol = protocol;
    this.#targetKmh = this.#clamp(initialTargetKmh);
  }

  get status() {
    return this.#status;
  }

  /** Speed for the next start, or the current target while running. */
  get targetKmh() {
    return this.#targetKmh;
  }

  /** The protocol range, capped by the maximum the treadmill reports. */
  get speedRange() {
    const range = this.protocol.speedRange;
    const reportedMax = this.#status?.maxSpeedKmh;
    if (reportedMax == null) return range;
    return reportedMax >= range.min && reportedMax < range.max ? { min: range.min, max: reportedMax } : range;
  }

  /** @param {number} nowMs */
  hasFreshStatus(nowMs) {
    return this.#status !== null && nowMs - this.#statusAtMs <= FRESH_MS;
  }

  /**
   * @param {TreadmillStatus} newStatus
   * @param {number} nowMs
   * @returns {Outcome}
   */
  onStatus(newStatus, nowMs) {
    this.#status = newStatus;
    this.#statusAtMs = nowMs;
    const commands = [];
    let notice = null;

    // A speed chosen at start or during the countdown is applied once the belt runs.
    const wanted = this.#pendingStartKmh;
    if (wanted !== null) {
      if (nowMs - this.#pendingStartAtMs > PENDING_START_TIMEOUT_MS) {
        this.#pendingStartKmh = null;
      } else if (newStatus.state === RunState.RUNNING) {
        this.#pendingStartKmh = null;
        const speed = this.#clamp(wanted);
        if (Math.abs(newStatus.targetSpeedKmh - speed) > SPEED_TOLERANCE_KMH) commands.push(this.#speedCommand(speed));
        this.#localChangeAtMs = nowMs;
      }
    }

    // Follow changes made with the remote, unless the user has just changed the speed here.
    const localChange = this.#localChangeAtMs;
    if (newStatus.state === RunState.RUNNING && this.#pendingStartKmh === null && newStatus.targetSpeedKmh > 0 &&
      (localChange === null || nowMs - localChange > LOCAL_CHANGE_HOLD_MS)) {
      this.#targetKmh = this.#clamp(newStatus.targetSpeedKmh);
    }

    // Make sure STOP took effect.
    const sentAt = this.#stopSentAtMs;
    if (sentAt !== null) {
      if (!isMoving(newStatus)) {
        this.#stopSentAtMs = null;
      } else if (nowMs - sentAt >= STOP_CHECK_MS) {
        if (this.#stopResends < MAX_STOP_RESENDS) {
          this.#stopResends++;
          this.#stopSentAtMs = nowMs;
          commands.push(this.#stopCommand());
        } else {
          this.#stopSentAtMs = null;
          notice = Notice.STOP_NOT_CONFIRMED;
        }
      }
    }
    return outcome(commands, notice);
  }

  /** The link dropped: forget the status and anything pending, so nothing is resent later. */
  onLinkDown() {
    this.#status = null;
    this.#pendingStartKmh = null;
    this.#stopSentAtMs = null;
    this.#stopResends = 0;
  }

  /**
   * @param {boolean} connected
   * @param {number} nowMs
   * @returns {Outcome}
   */
  startOrPause(connected, nowMs) {
    if (!connected) return outcome([], Notice.NOT_CONNECTED);
    const current = this.#status;
    if (current === null || !this.hasFreshStatus(nowMs)) return outcome([], Notice.NO_DATA);
    switch (current.state) {
      case RunState.RUNNING:
        this.#pendingStartKmh = null;
        return outcome([{ kind: CommandKind.CONTROL, frame: this.protocol.pauseFrame(), label: 'pausa' }]);
      case RunState.STARTING:
        return outcome();
      default: { // STOPPED or PAUSED
        const speed = this.#clamp(this.#targetKmh);
        this.#targetKmh = speed;
        this.#pendingStartKmh = speed;
        this.#pendingStartAtMs = nowMs;
        this.#stopSentAtMs = null;
        return outcome([
          { kind: CommandKind.CONTROL, frame: this.protocol.startFrame(speed), label: `arrancar ${format(speed)} km/h` },
        ]);
      }
    }
  }

  /**
   * @param {boolean} connected
   * @param {number} nowMs
   * @returns {Outcome}
   */
  stop(connected, nowMs) {
    if (!connected) return outcome([], Notice.NOT_CONNECTED);
    this.#pendingStartKmh = null;
    this.#stopSentAtMs = nowMs;
    this.#stopResends = 0;
    return outcome([this.#stopCommand()]);
  }

  /**
   * @param {number} deltaKmh
   * @param {boolean} connected
   * @param {number} nowMs
   */
  changeSpeed(deltaKmh, connected, nowMs) {
    return this.selectSpeed(this.#targetKmh + deltaKmh, connected, nowMs);
  }

  /**
   * @param {number} kmh
   * @param {boolean} connected
   * @param {number} nowMs
   * @returns {Outcome}
   */
  selectSpeed(kmh, connected, nowMs) {
    const speed = this.#clamp(kmh);
    this.#targetKmh = speed;
    this.#localChangeAtMs = nowMs;
    const current = this.#status;
    if (!connected || current === null || !this.hasFreshStatus(nowMs)) return outcome();
    switch (current.state) {
      case RunState.RUNNING:
        return outcome([this.#speedCommand(speed)]);
      case RunState.STARTING:
        this.#pendingStartKmh = speed;
        this.#pendingStartAtMs = nowMs;
        return outcome();
      default: // STOPPED or PAUSED
        return outcome();
    }
  }

  /** @param {number} speed */
  #speedCommand(speed) {
    return { kind: CommandKind.SPEED, frame: this.protocol.speedFrame(speed), label: `velocidad ${format(speed)} km/h` };
  }

  #stopCommand() {
    return { kind: CommandKind.STOP, frame: this.protocol.stopFrame(), label: 'PARAR' };
  }

  /**
   * Rounds to 0.1 km/h first, then clamps, so the result can never exceed the range.
   *
   * @param {number} kmh
   */
  #clamp(kmh) {
    if (!Number.isFinite(kmh)) throw new RangeError(`Velocidad no válida: ${kmh}`);
    const rounded = Math.round(kmh * 10) / 10;
    const { min, max } = this.speedRange;
    return Math.min(Math.max(rounded, min), max);
  }
}

/** @param {number} kmh */
const format = (kmh) => kmh.toFixed(1);
