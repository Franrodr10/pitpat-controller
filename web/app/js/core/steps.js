/** @typedef {import('./protocol.js').TreadmillStatus} TreadmillStatus */
/** @typedef {{count: number, estimated: boolean}} Steps */

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/**
 * Some firmwares always report 0 steps. Until the treadmill reports a real count, steps are
 * estimated from the distance walked, using a cadence that grows with speed: about 94 steps/min
 * at 3 km/h and 125 at 6 km/h, a rough fit of typical walking cadences.
 */
export class StepEstimator {
  #treadmillCounts = false;
  /** @type {number | null} */
  #lastDistanceKm = null;
  #lastDurationS = 0;
  #estimate = 0;

  /**
   * @param {TreadmillStatus} status
   * @returns {Steps}
   */
  update(status) {
    if (status.steps > 0) this.#treadmillCounts = true;
    if (this.#treadmillCounts) return { count: status.steps, estimated: false };

    const previous = this.#lastDistanceKm;
    if (previous === null || status.distanceKm < previous || status.durationSeconds < this.#lastDurationS) {
      // Connected mid-session or counters reset: start from the distance already walked.
      this.#estimate = status.distanceKm > 0
        ? status.distanceKm * 1000 / StepEstimator.stepLengthM(averageSpeed(status))
        : 0;
    } else {
      const walkedM = (status.distanceKm - previous) * 1000;
      const speed = status.speedKmh > 0 ? status.speedKmh : averageSpeed(status);
      if (walkedM > 0) this.#estimate += walkedM / StepEstimator.stepLengthM(speed);
    }
    this.#lastDistanceKm = status.distanceKm;
    this.#lastDurationS = status.durationSeconds;
    return { count: Math.round(this.#estimate), estimated: true };
  }

  reset() {
    this.#treadmillCounts = false;
    this.#lastDistanceKm = null;
    this.#lastDurationS = 0;
    this.#estimate = 0;
  }

  /**
   * Steps per minute when walking at kmh.
   *
   * @param {number} kmh
   */
  static cadence(kmh) {
    return 62 + 10.5 * clamp(kmh, 1, 8);
  }

  /** @param {number} kmh */
  static stepLengthM(kmh) {
    return clamp(kmh, 1, 8) * 1000 / 60 / StepEstimator.cadence(kmh);
  }
}

/** @param {TreadmillStatus} status */
function averageSpeed(status) {
  return status.durationSeconds > 0 ? status.distanceKm / (status.durationSeconds / 3600) : 3.0;
}
