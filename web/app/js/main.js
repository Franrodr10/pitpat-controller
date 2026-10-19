import { Alarm } from './alarm.js';
import { WebBluetoothTransport } from './ble.js';
import { isMoving } from './core/protocol.js';
import { DiagnosticsLog } from './log.js';
import { TreadmillManager, isActive } from './manager.js';
import { Settings } from './settings.js';
import { startUi } from './ui.js';
import { VERSION } from './version.js';
import { ScreenWakeLock } from './wake-lock.js';

const transport = new WebBluetoothTransport(/** @type {any} */ (navigator).bluetooth);
const settings = new Settings();
const log = new DiagnosticsLog();
const alarm = new Alarm();
const wakeLock = new ScreenWakeLock();
const manager = new TreadmillManager({ transport, settings, log, alarm });

log.add(`PitPat Controller web ${VERSION} · ${navigator.userAgent}`);
if (!transport.available) log.add('!! Este navegador no tiene Web Bluetooth');

startUi({ manager, settings, log, alarm, wakeLock, transport, version: VERSION });

// Keep the screen on for the whole session, whatever screen is showing.
manager.subscribe((state) => wakeLock.set(isActive(state)));

document.addEventListener('visibilitychange', () => {
  manager.onVisibilityChange(document.visibilityState === 'visible');
});

// Closing or reloading the page drops the link and the belt would keep going: ask first.
window.addEventListener('beforeunload', (event) => {
  const status = manager.state.status;
  if (status && isMoving(status)) {
    event.preventDefault();
    event.returnValue = '';
  }
});

if (transport.available) manager.resume();
