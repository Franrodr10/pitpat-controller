import { IncompatibleDeviceError, WriteResult } from './ble.js';
import { systemClock } from './clock.js';
import { RunState, isMoving, toHex } from './core/protocol.js';
import { CommandKind, CommandScheduler } from './core/scheduler.js';
import { Notice, SessionController } from './core/session.js';
import { StepEstimator } from './core/steps.js';
import { SUPPORTED_PROTOCOLS } from './protocols.js';

export const Link = Object.freeze({
  NO_DEVICE: 'NO_DEVICE',
  DISCONNECTED: 'DISCONNECTED',
  CONNECTING: 'CONNECTING',
  CONNECTED: 'CONNECTED',
  RECONNECTING: 'RECONNECTING',
});

export const Alert = Object.freeze({
  LINK_LOST: 'LINK_LOST',
  LINK_LOST_WHILE_MOVING: 'LINK_LOST_WHILE_MOVING',
  STOP_NOT_CONFIRMED: 'STOP_NOT_CONFIRMED',
});

export const Message = Object.freeze({
  NOT_CONNECTED: 'NOT_CONNECTED',
  NO_DATA: 'NO_DATA',
  RECONNECTED: 'RECONNECTED',
  INCOMPATIBLE: 'INCOMPATIBLE',
  CHOOSER_FAILED: 'CHOOSER_FAILED',
});

export const WATCHDOG_MS = 10_000;
export const MAX_BACKOFF_MS = 10_000;
export const MAX_STOP_RETRIES = 3;

/**
 * @typedef {import('./core/protocol.js').TreadmillProtocol} TreadmillProtocol
 * @typedef {import('./core/protocol.js').TreadmillStatus} TreadmillStatus
 * @typedef {import('./core/session.js').Outcome} Outcome
 * @typedef {import('./core/scheduler.js').Command} Command
 *
 * @typedef {object} State
 * @property {string} link One of Link.
 * @property {string | null} deviceName
 * @property {number} attempt
 * @property {TreadmillStatus | null} status
 * @property {boolean} fresh
 * @property {import('./core/steps.js').Steps | null} steps
 * @property {number} targetKmh
 * @property {import('./core/protocol.js').SpeedRange} speedRange
 * @property {string | null} alert One of Alert.
 */

/** @param {State} state */
export const isActive = (state) =>
  state.link === Link.CONNECTING || state.link === Link.CONNECTED || state.link === Link.RECONNECTING;

/**
 * Owns the link with the treadmill and exposes its state to the UI, like TreadmillManager.kt in
 * the Android app.
 *
 * Safety rules live in SessionController; this class adds the transport side: one write at a
 * time with STOP first, keep-alive, a watchdog for silent links, and reconnection with an alarm
 * and a visible alert when the link drops. Nothing is resent after reconnecting.
 */
export class TreadmillManager {
  #transport;
  #settings;
  #log;
  #alarm;
  #clock;
  #protocols;
  /** @type {TreadmillProtocol} */
  #protocol;
  /** @type {SessionController} */
  #controller;
  #scheduler = new CommandScheduler();
  #stepEstimator = new StepEstimator();
  #incomingLog = new IncomingLog();
  /** @type {import('./core/protocol.js').StatusDecoder | null} */
  #decoder = null;
  /**
   * The chosen BluetoothDevice; browsers only hand it out after the chooser (or getDevices).
   *
   * @type {any}
   */
  #device = null;
  /** @type {{controller: AbortController, done: Promise<void>, active: boolean} | null} */
  #session = null;
  /** Serializes session changes, so two taps never leave two sessions running. */
  #sessionChanges = Promise.resolve();
  /** @type {(() => void) | null} */
  #linkLost = null;
  /** The writer of the current link: whether it is busy, and how to wake it up. */
  #writer = { writing: false, wake: () => {} };
  #lastDataAtMs = 0;
  #stopFailures = 0;
  /** @type {State} */
  #state;
  /** @type {Set<(state: State) => void>} */
  #listeners = new Set();
  /** @type {Set<(message: string, detail?: string) => void>} */
  #messageListeners = new Set();

  /**
   * @param {object} deps
   * @param {any} deps.transport WebBluetoothTransport, or a fake in tests
   * @param {import('./settings.js').Settings} deps.settings
   * @param {import('./log.js').DiagnosticsLog} deps.log
   * @param {{alert: () => void}} deps.alarm
   * @param {import('./clock.js').Clock} [deps.clock]
   * @param {TreadmillProtocol[]} [deps.protocols]
   */
  constructor({ transport, settings, log, alarm, clock = systemClock, protocols = SUPPORTED_PROTOCOLS }) {
    this.#transport = transport;
    this.#settings = settings;
    this.#log = log;
    this.#alarm = alarm;
    this.#clock = clock;
    this.#protocols = protocols;
    this.#protocol = protocols.find((protocol) => protocol.name === settings.protocolName) ?? protocols[0];
    this.#controller = new SessionController(this.#protocol, settings.targetKmh);
    this.#state = {
      link: settings.deviceId ? Link.DISCONNECTED : Link.NO_DEVICE,
      deviceName: settings.deviceName,
      attempt: 0,
      status: null,
      fresh: false,
      steps: null,
      targetKmh: this.#controller.targetKmh,
      speedRange: this.#controller.speedRange,
      alert: null,
    };
  }

  get state() {
    return this.#state;
  }

  /** @param {(state: State) => void} listener */
  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** @param {(message: string, detail?: string) => void} listener */
  onMessage(listener) {
    this.#messageListeners.add(listener);
    return () => this.#messageListeners.delete(listener);
  }

  // ------------------------------------------------------------------ public API

  /** Reconnects on its own to the remembered treadmill, if the browser still allows it. */
  async resume() {
    const id = this.#settings.deviceId;
    if (this.#device || !id || !this.#transport.remembersDevices) return;
    const device = await this.#transport.remembered(id).catch(() => null);
    if (device && !this.#device) {
      this.#device = device;
      await this.#startSession();
    }
  }

  /** Opens the browser's chooser (call it from a tap) and connects to the treadmill chosen there. */
  async choose() {
    /** @type {any} */
    let device;
    try {
      device = await this.#transport.choose(this.#protocols);
    } catch (error) {
      if (/** @type {any} */ (error)?.name === 'NotFoundError') return false; // closed without choosing
      this.#log.add(`!! No se pudo abrir la búsqueda: ${describe(error)}`);
      this.#emit(Message.CHOOSER_FAILED, describe(error));
      return false;
    }
    await this.#cancelSession();
    this.#device = device;
    this.#settings.saveDevice(device.id, device.name ?? null);
    this.#update({ deviceName: device.name ?? null, alert: null });
    await this.#startSession();
    return true;
  }

  /**
   * "Conectar": the treadmill in memory, else the one the browser remembers, else the chooser.
   * Call it from a tap: browsers only open the chooser right after one, so nothing is awaited
   * before it unless the browser can remember devices.
   */
  async connect() {
    const id = this.#settings.deviceId;
    if (!this.#device && id && this.#transport.remembersDevices) {
      this.#device = await this.#transport.remembered(id).catch(() => null);
    }
    if (this.#device) await this.#startSession();
    else await this.choose();
  }

  async forget() {
    await this.#stopSession();
    try {
      await this.#device?.forget?.(); // also revoke the browser's permission, where supported
    } catch {
      // nothing else to undo
    }
    this.#device = null;
    this.#settings.forgetDevice();
    this.#update({ link: Link.NO_DEVICE, deviceName: null });
  }

  /**
   * The page was shown or hidden: keep a live link, but stop retrying a dead one in the background.
   * A lost-link alert stays up, so it is still there when the user comes back.
   *
   * @param {boolean} visible
   */
  async onVisibilityChange(visible) {
    if (visible) {
      if (!this.#session?.active && this.#device) await this.#startSession();
    } else if (this.#state.link !== Link.CONNECTED) {
      await this.#stopSession({ keepAlert: true });
    }
  }

  startOrPause() {
    this.#handle(this.#controller.startOrPause(this.#isConnected(), this.#clock.now()));
  }

  stop() {
    const outcome = this.#controller.stop(this.#isConnected(), this.#clock.now());
    if (outcome.notice === Notice.NOT_CONNECTED) this.#alarm.alert();
    this.#handle(outcome);
  }

  /** @param {number} deltaKmh */
  changeSpeed(deltaKmh) {
    this.#handle(this.#controller.changeSpeed(deltaKmh, this.#isConnected(), this.#clock.now()));
  }

  /** @param {number} kmh */
  selectSpeed(kmh) {
    this.#handle(this.#controller.selectSpeed(kmh, this.#isConnected(), this.#clock.now()));
  }

  dismissAlert() {
    this.#update({ alert: null });
  }

  // ------------------------------------------------------------------ session

  #isConnected() {
    return this.#state.link === Link.CONNECTED;
  }

  /** @param {() => Promise<void>} change */
  #serialized(change) {
    const run = this.#sessionChanges.then(change);
    this.#sessionChanges = run.catch(() => {});
    return run;
  }

  #startSession() {
    return this.#serialized(async () => {
      await this.#endSession();
      const controller = new AbortController();
      const session = { controller, done: Promise.resolve(), active: true };
      session.done = this.#runSession(controller.signal).finally(() => {
        session.active = false;
      });
      this.#session = session;
    });
  }

  #cancelSession() {
    return this.#serialized(() => this.#endSession());
  }

  #stopSession({ keepAlert = false } = {}) {
    return this.#serialized(async () => {
      await this.#endSession();
      this.#update({
        link: this.#settings.deviceId ? Link.DISCONNECTED : Link.NO_DEVICE,
        attempt: 0, status: null, fresh: false, steps: null, alert: keepAlert ? this.#state.alert : null,
      });
    });
  }

  /** Cancels the running session and waits until it has closed its connection. */
  async #endSession() {
    const session = this.#session;
    this.#session = null;
    if (!session) return;
    session.controller.abort();
    await session.done;
  }

  /**
   * Connects, then reconnects with backoff every time the link drops, until cancelled.
   *
   * @param {AbortSignal} signal
   */
  async #runSession(signal) {
    let attempt = 0;
    while (!signal.aborted) {
      this.#update({ link: attempt === 0 ? Link.CONNECTING : Link.RECONNECTING, attempt });
      let connection = null;
      let linkWasUp = false;
      try {
        this.#log.add(`Conectando con ${this.#state.deviceName ?? 'la cinta'}…`);
        connection = await this.#transport.connect(this.#device, this.#protocols, this.#gattListener, signal);
        if (signal.aborted) break;
        linkWasUp = true;
        attempt = 0;
        this.#onConnected(connection);
        await this.#awaitLinkLoss(connection, signal);
      } catch (error) {
        if (signal.aborted) break;
        if (error instanceof IncompatibleDeviceError) {
          // Forget it, so the next tap opens the browser's list instead of trying it again.
          this.#log.add(`!! Dispositivo incompatible: ${error.message}`);
          this.#device = null;
          this.#settings.forgetDevice();
          this.#emit(Message.INCOMPATIBLE);
          this.#update({ link: Link.NO_DEVICE, deviceName: null, attempt: 0 });
          return;
        }
        this.#log.add(`!! No se pudo conectar: ${describe(error)}`);
      } finally {
        connection?.close();
        if (linkWasUp) this.#onLinkDown(signal.aborted);
      }
      if (signal.aborted) break;
      attempt++;
      // Not connected any more from this moment: STOP must warn instead of queuing silently.
      this.#update({ link: Link.RECONNECTING, attempt });
      await this.#clock.sleep(Math.min(1_000 * 2 ** Math.min(attempt - 1, 4), MAX_BACKOFF_MS), signal);
    }
  }

  #gattListener = {
    /**
     * @param {string} characteristic
     * @param {Uint8Array} value
     */
    onData: (characteristic, value) => this.#onIncoming(characteristic, value),
    onDisconnected: () => {
      this.#log.add('!! Conexión perdida');
      this.#linkLost?.();
    },
  };

  /** @param {{protocol: TreadmillProtocol}} connection */
  #onConnected(connection) {
    if (connection.protocol !== this.#protocol) {
      this.#protocol = connection.protocol;
      this.#controller = new SessionController(this.#protocol, this.#controller.targetKmh);
    }
    this.#settings.saveProtocol(this.#protocol.name);
    this.#decoder = this.#protocol.newDecoder();
    this.#stepEstimator.reset();
    this.#scheduler.clear();
    this.#incomingLog.reset();
    this.#lastDataAtMs = this.#clock.now();
    const previous = this.#state.alert;
    const wasLost = previous === Alert.LINK_LOST || previous === Alert.LINK_LOST_WHILE_MOVING;
    this.#log.add(`Conectado (${this.#protocol.name}, heartbeat ${this.#settings.keepAlive ? 'activado' : 'desactivado'})`);
    this.#update({
      link: Link.CONNECTED, attempt: 0, alert: wasLost ? null : previous,
      targetKmh: this.#controller.targetKmh, speedRange: this.#controller.speedRange,
    });
    if (wasLost) this.#emit(Message.RECONNECTED);
  }

  /**
   * Runs the writer, keep-alive and watchdog until the link is lost or the session is cancelled.
   *
   * @param {any} connection
   * @param {AbortSignal} signal
   */
  async #awaitLinkLoss(connection, signal) {
    const link = new AbortController();
    const lose = () => link.abort();
    this.#linkLost = lose;
    signal.addEventListener('abort', lose, { once: true });
    const writer = { writing: false, wake: () => {} };
    this.#writer = writer;
    this.#writerLoop(connection, writer, link.signal);
    this.#keepAliveLoop(writer, link.signal);
    this.#watchdogLoop(link.signal);
    try {
      if (!link.signal.aborted) await new Promise((resolve) => link.signal.addEventListener('abort', resolve, { once: true }));
    } finally {
      signal.removeEventListener('abort', lose);
      if (this.#linkLost === lose) this.#linkLost = null;
      writer.wake(); // lets the writer see that the link is gone
    }
  }

  /**
   * Forgets everything pending: after a reconnection nothing is resent on its own.
   *
   * @param {boolean} byUser
   */
  #onLinkDown(byUser) {
    const status = this.#state.status;
    const wasMoving = status !== null && isMoving(status);
    this.#scheduler.clear();
    this.#controller.onLinkDown();
    this.#decoder = null;
    this.#update({ status: null, fresh: false, steps: null, speedRange: this.#controller.speedRange });
    if (!byUser) {
      this.#update({ alert: wasMoving ? Alert.LINK_LOST_WHILE_MOVING : Alert.LINK_LOST });
      this.#alarm.alert();
    }
  }

  // ------------------------------------------------------------------ data in, commands out

  /**
   * @param {string} characteristic
   * @param {Uint8Array} value
   */
  #onIncoming(characteristic, value) {
    const now = this.#clock.now();
    this.#lastDataAtMs = now;
    const statuses = this.#decoder?.(characteristic, value, now) ?? [];
    const line = this.#incomingLog.line(value, statuses.at(-1) ?? null, now);
    if (line) this.#log.add(line);
    for (const status of statuses) {
      this.#handle(this.#controller.onStatus(status, now));
      const steps = this.#stepEstimator.update(status);
      const alert = this.#state.alert === Alert.STOP_NOT_CONFIRMED && !isMoving(status) ? null : this.#state.alert;
      this.#update({ status, fresh: true, steps, alert });
    }
  }

  /** @param {Outcome} outcome */
  #handle(outcome) {
    if (outcome.commands.length > 0) {
      for (const command of outcome.commands) this.#scheduler.submit(command);
      this.#writer.wake();
    }
    switch (outcome.notice) {
      case Notice.NOT_CONNECTED:
        this.#emit(Message.NOT_CONNECTED);
        break;
      case Notice.NO_DATA:
        this.#emit(Message.NO_DATA);
        break;
      case Notice.STOP_NOT_CONFIRMED:
        this.#stopNotConfirmed();
        break;
      default:
        break;
    }
    this.#settings.targetKmh = this.#controller.targetKmh;
    this.#update({ targetKmh: this.#controller.targetKmh, speedRange: this.#controller.speedRange });
  }

  #stopNotConfirmed() {
    this.#log.add('!! La cinta no confirma la parada');
    this.#update({ alert: Alert.STOP_NOT_CONFIRMED });
    this.#alarm.alert();
  }

  /**
   * @param {any} connection
   * @param {{writing: boolean, wake: () => void}} writer
   * @param {AbortSignal} signal
   */
  async #writerLoop(connection, writer, signal) {
    while (!signal.aborted) {
      const command = this.#scheduler.next();
      if (command === null) {
        await /** @type {Promise<void>} */ (new Promise((resolve) => {
          writer.wake = () => {
            writer.wake = () => {};
            resolve();
          };
        }));
        continue;
      }
      writer.writing = true;
      let result;
      try {
        result = await connection.write(command.frame);
      } finally {
        writer.writing = false;
      }
      if (signal.aborted) return;
      if (command.kind !== CommandKind.KEEP_ALIVE || result !== WriteResult.OK) {
        this.#log.add(`-> ${toHex(command.frame)} (${command.label}) ${result.toLowerCase()}`);
      }
      if (command.kind === CommandKind.STOP) await this.#onStopWritten(command, result, signal);
    }
  }

  /**
   * @param {Command} command
   * @param {string} result
   * @param {AbortSignal} signal
   */
  async #onStopWritten(command, result, signal) {
    if (result === WriteResult.OK) {
      this.#stopFailures = 0;
      return;
    }
    this.#stopFailures++;
    if (this.#stopFailures <= MAX_STOP_RETRIES) {
      await this.#clock.sleep(100, signal);
      if (!signal.aborted) this.#scheduler.submit(command); // the writer picks it up next
    } else {
      this.#stopFailures = 0;
      this.#stopNotConfirmed();
    }
  }

  /**
   * @param {{writing: boolean, wake: () => void}} writer
   * @param {AbortSignal} signal
   */
  async #keepAliveLoop(writer, signal) {
    const protocol = this.#protocol;
    if (!protocol.keepAliveFrame) return;
    while (!signal.aborted) {
      await this.#clock.sleep(protocol.keepAliveIntervalMs, signal);
      if (signal.aborted) return;
      if (this.#settings.keepAlive && !writer.writing && this.#scheduler.isEmpty) {
        this.#scheduler.submit({ kind: CommandKind.KEEP_ALIVE, frame: protocol.keepAliveFrame, label: 'keep-alive' });
        writer.wake();
      }
    }
  }

  /**
   * Some links die without the browser noticing for a long time: no data for a while means lost.
   *
   * @param {AbortSignal} signal
   */
  async #watchdogLoop(signal) {
    while (!signal.aborted) {
      await this.#clock.sleep(1_000, signal);
      if (signal.aborted) return;
      const now = this.#clock.now();
      const fresh = this.#controller.hasFreshStatus(now);
      if (this.#state.fresh !== fresh) this.#update({ fresh });
      const silentMs = now - this.#lastDataAtMs;
      if (silentMs > WATCHDOG_MS) {
        this.#log.add(`!! Sin datos de la cinta durante ${Math.floor(silentMs / 1000)} s: se reinicia la conexión`);
        this.#linkLost?.();
        return;
      }
    }
  }

  // ------------------------------------------------------------------ state out

  /** @param {Partial<State>} patch */
  #update(patch) {
    this.#state = { ...this.#state, ...patch };
    for (const listener of this.#listeners) listener(this.#state);
  }

  /**
   * @param {string} message
   * @param {string} [detail]
   */
  #emit(message, detail) {
    for (const listener of this.#messageListeners) listener(message, detail);
  }
}

/** @param {any} error */
function describe(error) {
  return error?.message || error?.name || String(error);
}

/** Keeps the diagnostics log readable: frames are logged when something but the counters changes. */
class IncomingLog {
  /** @type {string | null} */
  #lastKey = null;
  #lastAtMs = 0;
  #skipped = 0;
  #undecoded = 0;

  reset() {
    this.#lastKey = null;
    this.#skipped = 0;
    this.#undecoded = 0;
  }

  /**
   * @param {Uint8Array} raw
   * @param {TreadmillStatus | null} status
   * @param {number} nowMs
   */
  line(raw, status, nowMs) {
    if (status === null) {
      this.#undecoded++;
      return this.#undecoded <= 20 || this.#undecoded % 50 === 0 ? `<- ${toHex(raw)}` : null;
    }
    const key = `${status.state}/${status.targetSpeedKmh}/${Math.round(status.speedKmh * 10)}`;
    if (key === this.#lastKey && nowMs - this.#lastAtMs < 5_000) {
      this.#skipped++;
      return null;
    }
    const extra = this.#skipped > 0 ? ` (+${this.#skipped})` : '';
    this.#lastKey = key;
    this.#lastAtMs = nowMs;
    this.#skipped = 0;
    return `<- ${toHex(raw)} | ${describeStatus(status)}${extra}`;
  }
}

const STATE_NAMES = {
  [RunState.STOPPED]: 'parada',
  [RunState.STARTING]: 'cuenta atrás',
  [RunState.RUNNING]: 'en marcha',
  [RunState.PAUSED]: 'en pausa',
};

/** @param {TreadmillStatus} s */
function describeStatus(s) {
  return `${STATE_NAMES[s.state]} v=${s.speedKmh.toFixed(2)} obj=${s.targetSpeedKmh.toFixed(2)} ` +
    `d=${s.distanceKm.toFixed(3)} t=${s.durationSeconds} pasos=${s.steps} kcal=${s.kcal} máx=${s.maxSpeedKmh ?? '-'}`;
}
