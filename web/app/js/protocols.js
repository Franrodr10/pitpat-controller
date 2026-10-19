import { PitPatProtocol } from './core/pitpat.js';

/**
 * Every treadmill family the web app can control. The browser's chooser lists the devices that
 * match any of them, and a connection uses the first one whose GATT service the device has.
 *
 * @type {import('./core/protocol.js').TreadmillProtocol[]}
 */
export const SUPPORTED_PROTOCOLS = [PitPatProtocol];
