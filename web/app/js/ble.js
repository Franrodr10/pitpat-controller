// Web Bluetooth side of the app: the browser's device chooser and one GATT connection at a time.
// Works in Chrome and Edge (Android, Windows, macOS, Linux) and, on iPhone, in Bluefy.

export const WriteResult = Object.freeze({
  OK: 'OK',
  TIMEOUT: 'TIMEOUT',
  FAILED: 'FAILED',
  NOT_CONNECTED: 'NOT_CONNECTED',
});

export class IncompatibleDeviceError extends Error {}

class TimeoutError extends Error {}

const CONNECT_TIMEOUT_MS = 12_000;
const OP_TIMEOUT_MS = 5_000;
const WRITE_TIMEOUT_MS = 1_500;
const BUSY_RETRY_MS = 25;

/**
 * @typedef {import('./core/protocol.js').TreadmillProtocol} TreadmillProtocol
 * @typedef {{onData: (characteristic: string, value: Uint8Array) => void, onDisconnected: () => void}} Listener
 */

export class WebBluetoothTransport {
  /** @param {any} bluetooth navigator.bluetooth, or undefined when the browser has no Web Bluetooth */
  constructor(bluetooth) {
    this.bluetooth = bluetooth ?? null;
  }

  get available() {
    return this.bluetooth !== null;
  }

  /** Whether the browser lets the page reconnect to a treadmill chosen before a reload. */
  get remembersDevices() {
    return typeof this.bluetooth?.getDevices === 'function';
  }

  /**
   * Opens the browser's chooser with the treadmills of every protocol. Only works inside a tap.
   * Rejects with a NotFoundError if the user closes it without choosing.
   *
   * @param {TreadmillProtocol[]} protocols
   */
  choose(protocols) {
    const filters = protocols.flatMap((protocol) => [
      ...protocol.namePrefixes.map((namePrefix) => ({ namePrefix })),
      ...protocol.advertisedServices.map((service) => ({ services: [service] })),
    ]);
    const optionalServices = [...new Set(protocols.map((protocol) => protocol.service))];
    return this.bluetooth.requestDevice({ filters, optionalServices });
  }

  /**
   * The device with this id, if the user allowed it before and the browser still remembers it.
   *
   * @param {string} id
   */
  async remembered(id) {
    if (!this.remembersDevices) return null;
    const devices = await this.bluetooth.getDevices();
    return devices.find((device) => device.id === id) ?? null;
  }

  /**
   * Connects and subscribes to the status characteristics. Throws on failure.
   *
   * @param {any} device a BluetoothDevice
   * @param {TreadmillProtocol[]} protocols
   * @param {Listener} listener
   * @param {AbortSignal} signal aborting it cancels the connection attempt
   */
  async connect(device, protocols, listener, signal) {
    const connection = new GattConnection(device, listener);
    try {
      await connection.open(protocols, signal);
      return connection;
    } catch (error) {
      connection.close();
      throw error;
    }
  }
}

/**
 * One GATT session: connect, find the protocol's service, subscribe to its status
 * characteristics, then write command frames. The caller writes one frame at a time, because
 * browsers reject a GATT operation while another one is in flight.
 */
class GattConnection {
  /** @type {TreadmillProtocol | null} */
  protocol = null;
  #device;
  #listener;
  /** @type {any} */
  #command = null;
  /** @type {any[]} */
  #status = [];
  #ready = false;
  #closed = false;

  /**
   * @param {any} device
   * @param {Listener} listener
   */
  constructor(device, listener) {
    this.#device = device;
    this.#listener = listener;
  }

  /**
   * @param {TreadmillProtocol[]} protocols
   * @param {AbortSignal} signal
   */
  async open(protocols, signal) {
    this.#device.addEventListener('gattserverdisconnected', this.#onDisconnected);
    const server = await step(this.#device.gatt.connect(), CONNECT_TIMEOUT_MS, signal, 'la cinta no responde');
    for (const protocol of protocols) {
      const service = await step(server.getPrimaryService(protocol.service), OP_TIMEOUT_MS, signal, 'sin respuesta')
        .catch((error) => {
          if (error.name === 'NotFoundError') return null;
          throw error;
        });
      if (service === null) continue;
      try {
        for (const uuid of protocol.statusCharacteristics) {
          const characteristic = await step(service.getCharacteristic(uuid), OP_TIMEOUT_MS, signal, 'sin respuesta');
          characteristic.addEventListener('characteristicvaluechanged', this.#onValue);
          this.#status.push(characteristic);
          await step(characteristic.startNotifications(), OP_TIMEOUT_MS, signal, 'no se pudo activar las notificaciones');
        }
        this.#command = await step(service.getCharacteristic(protocol.commandCharacteristic), OP_TIMEOUT_MS, signal, 'sin respuesta');
      } catch (error) {
        if (/** @type {any} */ (error)?.name === 'NotFoundError') {
          throw new IncompatibleDeviceError(`falta una característica de ${protocol.name}`);
        }
        throw error;
      }
      this.protocol = protocol;
      this.#ready = true;
      return;
    }
    throw new IncompatibleDeviceError('no tiene el servicio de ninguna cinta compatible');
  }

  /** @param {Uint8Array} frame */
  async write(frame) {
    const deadline = performance.now() + WRITE_TIMEOUT_MS;
    for (;;) {
      if (this.#closed || !this.#ready || !this.#device.gatt.connected) return WriteResult.NOT_CONNECTED;
      const characteristic = this.#command;
      try {
        const writing = characteristic.writeValueWithResponse
          ? characteristic.writeValueWithResponse(frame)
          : characteristic.writeValue(frame);
        await step(writing, deadline - performance.now(), null, 'sin confirmación');
        return WriteResult.OK;
      } catch (error) {
        if (error instanceof TimeoutError) return WriteResult.TIMEOUT;
        // The browser is still busy with an earlier operation (a late write): try again shortly.
        if (/progress|busy/i.test(String(/** @type {any} */ (error)?.message)) && performance.now() + BUSY_RETRY_MS < deadline) {
          await new Promise((resolve) => setTimeout(resolve, BUSY_RETRY_MS));
          continue;
        }
        return this.#device.gatt.connected ? WriteResult.FAILED : WriteResult.NOT_CONNECTED;
      }
    }
  }

  close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#device.removeEventListener('gattserverdisconnected', this.#onDisconnected);
    for (const characteristic of this.#status) {
      characteristic.removeEventListener('characteristicvaluechanged', this.#onValue);
    }
    // Also aborts a connection attempt that is still pending.
    this.#device.gatt.disconnect();
  }

  #onDisconnected = () => {
    if (this.#ready && !this.#closed) this.#listener.onDisconnected();
  };

  /** @param {any} event */
  #onValue = (event) => {
    if (this.#closed) return;
    const value = event.target.value; // a DataView over a buffer the browser may reuse: copy it
    const bytes = new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
    this.#listener.onData(event.target.uuid, bytes);
  };
}

/**
 * Waits for a GATT step, but not longer than timeoutMs, and not after signal aborts.
 *
 * @template T
 * @param {Promise<T>} promise
 * @param {number} timeoutMs
 * @param {AbortSignal | null} signal
 * @param {string} timeoutMessage
 * @returns {Promise<T>}
 */
function step(promise, timeoutMs, signal, timeoutMessage) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Cancelado', 'AbortError'));
      return;
    }
    const onAbort = () => finish(reject, new DOMException('Cancelado', 'AbortError'));
    const timer = setTimeout(() => finish(reject, new TimeoutError(timeoutMessage)), Math.max(timeoutMs, 0));
    signal?.addEventListener('abort', onAbort, { once: true });
    promise.then((value) => finish(resolve, value), (error) => finish(reject, error));

    function finish(settle, value) {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      settle(value);
    }
  });
}
