// Numbers as written in Spanish: "3,5 km/h", "1.234 pasos" (same as Format.kt in the Android app).

const oneDecimal = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const twoDecimals = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// "always": Spanish rules leave four-digit numbers ungrouped ("1234"), the Android app groups them.
const integer = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0, useGrouping: 'always' });

/** @param {number} kmh */
export const speed = (kmh) => oneDecimal.format(kmh);

/**
 * Presets without a useless ",0": "3", "3,5".
 *
 * @param {number} kmh
 */
export const preset = (kmh) => (Number.isInteger(kmh) ? String(kmh) : speed(kmh));

/** @param {number} km */
export const distance = (km) => twoDecimals.format(km);

/** @param {number} value */
export const count = (value) => integer.format(value);

/** @param {number} totalSeconds */
export function duration(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const two = (n) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${two(minutes)}:${two(seconds)}`;
}

/**
 * Accepts "3,5" or "3.5"; rounds to one decimal. Returns null for anything else.
 *
 * @param {string} text
 */
export function parseSpeed(text) {
  const normalized = text.trim().replace(',', '.');
  if (!/^\d+(\.\d*)?$|^\.\d+$/.test(normalized)) return null;
  return Math.round(Number.parseFloat(normalized) * 10) / 10;
}
