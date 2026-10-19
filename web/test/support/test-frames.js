import { checksum } from '../../app/js/core/pitpat.js';

/** Builds synthetic 52-byte PitPat status frames for tests (same as TestFrames.kt). */
export function statusFrame({
  flags = 0x08,
  speed = 3500,
  target = speed,
  distanceM = 1234,
  steps = 1520,
  kcal = 56,
  durationRaw = 754_000,
  firmware = 27,
  maxSpeed = 6000,
} = {}) {
  const frame = new Uint8Array(52);
  frame[0] = 0x68;
  frame[1] = frame.length;
  put(frame, 3, speed, 2);
  put(frame, 5, target, 2);
  put(frame, 7, distanceM, 4);
  put(frame, 14, steps, 4);
  put(frame, 18, kcal, 2);
  put(frame, 20, durationRaw, 4);
  frame[25] = firmware;
  frame[26] = flags;
  put(frame, 27, maxSpeed, 2);
  frame[50] = checksum(frame);
  frame[51] = 0x43;
  return frame;
}

/** "6A 05 FD F8 43" → bytes. */
export function hex(text) {
  return Uint8Array.from(text.replace(/\s+/g, '').match(/../g), (pair) => parseInt(pair, 16));
}

function put(frame, offset, value, size) {
  for (let i = 0; i < size; i++) frame[offset + i] = Math.floor(value / 256 ** (size - 1 - i)) & 0xff;
}
