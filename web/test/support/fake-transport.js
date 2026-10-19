import { IncompatibleDeviceError, WriteResult } from '../../app/js/ble.js';
import { PitPatProtocol } from '../../app/js/core/pitpat.js';
import { SimulatedTreadmill } from './treadmill-sim.js';

/**
 * Stands in for WebBluetoothTransport: the "browser" offers one simulated treadmill, which sends
 * a status frame every 500 ms of the fake clock while connected.
 */
export class FakeTransport {
  remembersDevices = false;
  device = { id: 'sim-1', name: 'PitPat-T01' };
  treadmill = new SimulatedTreadmill();
  connectAttempts = 0;
  /** What the next connection attempts do: 'ok', 'fail' or 'incompatible'. */
  nextConnect = 'ok';
  /** What writes return; anything but OK also means the treadmill never got the frame. */
  writeResult = WriteResult.OK;
  /** When false, the treadmill stays connected but stops sending its status. */
  sending = true;
  /** @type {FakeConnection | null} */
  connection = null;
  /**
   * Every frame the app tried to write, delivered or not.
   *
   * @type {Uint8Array[]}
   */
  attempted = [];

  /** @param {import('./fake-clock.js').FakeClock} clock */
  constructor(clock) {
    this.clock = clock;
  }

  async choose() {
    return this.device;
  }

  async remembered(id) {
    return this.remembersDevices && id === this.device.id ? this.device : null;
  }

  async connect(device, protocols, listener, signal) {
    this.connectAttempts++;
    await this.clock.sleep(100, signal);
    if (signal.aborted) throw new DOMException('Cancelado', 'AbortError');
    if (this.nextConnect === 'fail') throw new Error('la cinta no responde');
    if (this.nextConnect === 'incompatible') throw new IncompatibleDeviceError('no tiene el servicio de ninguna cinta compatible');
    this.connection = new FakeConnection(this, listener);
    return this.connection;
  }

  /** The treadmill drops the link, as when it goes out of range. */
  dropLink() {
    this.connection?.drop();
  }

  /** Frames the treadmill received, without keep-alives. */
  commands() {
    return this.treadmill.received.filter((frame) => frame.length === 23);
  }
}

class FakeConnection {
  protocol = PitPatProtocol;
  open = true;

  constructor(transport, listener) {
    this.transport = transport;
    this.listener = listener;
    this.#notify();
  }

  async #notify() {
    const { clock, treadmill } = this.transport;
    while (this.open) {
      await clock.sleep(500);
      if (!this.open) return;
      treadmill.tick(500);
      if (this.transport.sending) this.listener.onData(PitPatProtocol.statusCharacteristics[0], treadmill.statusFrame());
    }
  }

  async write(frame) {
    this.transport.attempted.push(frame);
    if (!this.open) return WriteResult.NOT_CONNECTED;
    await this.transport.clock.sleep(20);
    if (!this.open) return WriteResult.NOT_CONNECTED;
    if (this.transport.writeResult !== WriteResult.OK) return this.transport.writeResult;
    this.transport.treadmill.receive(frame);
    return WriteResult.OK;
  }

  drop() {
    if (!this.open) return;
    this.open = false;
    this.listener.onDisconnected();
  }

  close() {
    this.open = false;
  }
}
