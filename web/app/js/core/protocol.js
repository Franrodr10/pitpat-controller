// The protocol layer of the web version. It mirrors core/src/main/kotlin/.../protocol, which the
// Android app uses: same names, same rules, same tests (web/test).

/**
 * Describes how to talk to one family of treadmills over Bluetooth Low Energy.
 *
 * The app only knows this shape. To support another treadmill, write an object like
 * PitPatProtocol and add it to SUPPORTED_PROTOCOLS in ../protocols.js (see README).
 *
 * @typedef {object} TreadmillProtocol
 * @property {string} name Name shown to the user, e.g. "PitPat".
 * @property {string} service GATT service that holds the command and status characteristics.
 * @property {string} commandCharacteristic Receives the command frames (written with response).
 * @property {readonly string[]} statusCharacteristics Characteristics to subscribe to.
 * @property {readonly string[]} advertisedServices Advertised service UUIDs that identify a compatible treadmill.
 * @property {readonly string[]} namePrefixes Name prefixes that identify a compatible treadmill.
 * @property {SpeedRange} speedRange Speeds (km/h) the app may command. Nothing outside it is ever sent.
 * @property {Uint8Array | null} keepAliveFrame Sent every keepAliveIntervalMs, or null if there is none.
 * @property {number} keepAliveIntervalMs
 * @property {(speedKmh: number) => Uint8Array} startFrame
 * @property {(speedKmh: number) => Uint8Array} speedFrame
 * @property {() => Uint8Array} pauseFrame
 * @property {() => Uint8Array} stopFrame
 * @property {() => StatusDecoder} newDecoder Creates the decoder for one connection; it may keep
 *   partial frames between calls.
 */

/** @typedef {{min: number, max: number}} SpeedRange */

/**
 * Decodes the bytes received from a characteristic at timeMs and returns every complete status.
 *
 * @callback StatusDecoder
 * @param {string} characteristic
 * @param {Uint8Array} data
 * @param {number} timeMs
 * @returns {TreadmillStatus[]}
 */

export const RunState = Object.freeze({
  STOPPED: 'STOPPED',
  STARTING: 'STARTING',
  RUNNING: 'RUNNING',
  PAUSED: 'PAUSED',
});

/**
 * @typedef {object} TreadmillStatus
 * @property {string} state One of RunState.
 * @property {number} speedKmh
 * @property {number} targetSpeedKmh
 * @property {number} distanceKm
 * @property {number} durationSeconds
 * @property {number} steps As reported by the treadmill; some firmwares always report 0.
 * @property {number} kcal
 * @property {number | null} maxSpeedKmh Maximum speed reported by the treadmill, or null.
 */

/** @param {TreadmillStatus} status */
export function isMoving(status) {
  return status.state === RunState.RUNNING || status.state === RunState.STARTING;
}

/**
 * Expands a 16-bit UUID (e.g. 0xFBA0) with the Bluetooth base UUID, in the lowercase form Web
 * Bluetooth uses.
 *
 * @param {number} short
 */
export function uuid16(short) {
  return `${short.toString(16).padStart(8, '0')}-0000-1000-8000-00805f9b34fb`;
}

/** @param {Uint8Array} bytes */
export function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
}

/**
 * @param {TreadmillProtocol} protocol
 * @param {string | null | undefined} name
 * @param {string[]} services
 */
export function matchesAdvertisement(protocol, name, services) {
  return protocol.namePrefixes.some((prefix) => name?.startsWith(prefix)) ||
    services.some((service) => protocol.advertisedServices.includes(service));
}
