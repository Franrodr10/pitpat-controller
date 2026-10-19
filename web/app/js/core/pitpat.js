import { FrameReassembler } from './frame-reassembler.js';
import { RunState, uuid16 } from './protocol.js';

// PitPat treadmills with service 0xFBA0 (BLE name "PitPat-T01").
// Frame layout and field offsets are documented in docs/PROTOCOL.md.

const COMMAND_START = 0x6a;
const END = 0x43;
const OP_STOP = 0x00;
const OP_PAUSE = 0x02;
const OP_START = 0x04;
const MODE_START = 1;
const MODE_SPEED = 5;
const WEIGHT_KG = 80;
/** User id 58 965 456 623 as eight big-endian bytes. */
const USER_ID = [0x00, 0x00, 0x00, 0x0d, 0xba, 0x9d, 0x76, 0xef];
const MIN_STATUS_LENGTH = 31;
const SPEED_RANGE = Object.freeze({ min: 1.0, max: 6.0 });

/**
 * XOR of every byte between the start byte and the checksum byte.
 *
 * @param {Uint8Array} frame
 */
export function checksum(frame) {
  let value = 0;
  for (let i = 1; i < frame.length - 2; i++) value ^= frame[i];
  return value;
}

/** @param {Uint8Array} frame */
export function isValidFrame(frame) {
  return frame.length >= 5 && frame[1] === frame.length &&
    frame[frame.length - 1] === END && frame[frame.length - 2] === checksum(frame);
}

/**
 * @param {Uint8Array} frame
 * @returns {import('./protocol.js').TreadmillStatus | null}
 */
export function parseStatus(frame) {
  if (frame.length < MIN_STATUS_LENGTH || !isValidFrame(frame)) return null;
  const u8 = (i) => frame[i];
  const u16 = (i) => u8(i) * 0x100 + u8(i + 1);
  const u32 = (i) => u16(i) * 0x10000 + u16(i + 2);
  const firmware = u8(25);
  const maxSpeed = u16(27);
  return {
    state: runState(u8(26)),
    speedKmh: u16(3) / 1000,
    targetSpeedKmh: u16(5) / 1000,
    distanceKm: u32(7) / 1000,
    durationSeconds: firmware > 19 ? Math.floor(u32(20) / 1000) : u32(20), // ms since firmware 20
    steps: u32(14),
    kcal: u16(18),
    maxSpeedKmh: maxSpeed > 0 ? maxSpeed / 1000 : null,
  };
}

/** @param {number} flags */
function runState(flags) {
  switch (flags & 0x18) {
    case 0x18: return RunState.STARTING;
    case 0x08: return RunState.RUNNING;
    case 0x10: return RunState.PAUSED;
    default: return RunState.STOPPED;
  }
}

/**
 * @param {number} op
 * @param {number} speedKmh
 * @param {number} mode
 */
function controlFrame(op, speedKmh, mode) {
  const speed = op === OP_START ? Math.round(clampSpeed(speedKmh) * 1000) : 0;
  const frame = new Uint8Array(23);
  frame[0] = COMMAND_START;
  frame[1] = frame.length;
  frame[6] = speed >> 8;
  frame[7] = speed & 0xff;
  frame[8] = mode;
  frame[10] = WEIGHT_KG;
  frame[12] = op; // bit 3 clear = metric units
  frame.set(USER_ID, 13);
  frame[21] = checksum(frame);
  frame[22] = END;
  return frame;
}

/** @param {number} kmh */
function clampSpeed(kmh) {
  if (!Number.isFinite(kmh)) throw new RangeError(`Velocidad no válida: ${kmh}`);
  return Math.min(Math.max(kmh, SPEED_RANGE.min), SPEED_RANGE.max);
}

/** @type {import('./protocol.js').TreadmillProtocol} */
export const PitPatProtocol = {
  name: 'PitPat',
  service: uuid16(0xfba0),
  commandCharacteristic: uuid16(0xfba1),
  statusCharacteristics: Object.freeze([uuid16(0xfba2)]),
  advertisedServices: Object.freeze([uuid16(0xfba0), uuid16(0x1910)]),
  namePrefixes: Object.freeze(['PitPat']),
  speedRange: SPEED_RANGE,
  get keepAliveFrame() {
    return Uint8Array.of(0x6a, 0x05, 0xfd, 0xf8, END);
  },
  keepAliveIntervalMs: 1000,
  startFrame: (speedKmh) => controlFrame(OP_START, speedKmh, MODE_START),
  speedFrame: (speedKmh) => controlFrame(OP_START, speedKmh, MODE_SPEED),
  pauseFrame: () => controlFrame(OP_PAUSE, 0, MODE_START),
  stopFrame: () => controlFrame(OP_STOP, 0, MODE_START),
  newDecoder() {
    const reassembler = new FrameReassembler();
    return (_characteristic, data, timeMs) =>
      reassembler.feed(data, timeMs).map(parseStatus).filter((status) => status !== null);
  },
};
Object.freeze(PitPatProtocol);
