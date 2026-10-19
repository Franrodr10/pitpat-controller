// Injected into the page before the app loads: a Web Bluetooth API backed by the simulated
// treadmill of ../support/treadmill-sim.js. Tests drive it through window.__bluetooth.
(() => {
  const SERVICE = '0000fba0-0000-1000-8000-00805f9b34fb';
  const COMMAND = '0000fba1-0000-1000-8000-00805f9b34fb';
  const STATUS = '0000fba2-0000-1000-8000-00805f9b34fb';
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const networkError = () => new DOMException('GATT Server is disconnected.', 'NetworkError');

  const control = {
    /** @type {any} */ treadmill: null,
    /** @type {any} */ device: null,
    /** Every frame written to the command characteristic. */
    writes: [],
    /** Options passed to requestDevice, to check the chooser's filters. */
    lastRequest: null,
    chooserCancels: false,
    sending: true,
    reachable: true,
    /** The treadmill drops the link, as when it goes out of range. */
    dropLink() {
      control.device?.drop();
    },
    commands() {
      return control.writes.filter((frame) => frame.length === 23);
    },
  };
  window.__bluetooth = control;

  class Characteristic extends EventTarget {
    constructor(device, uuid) {
      super();
      this.device = device;
      this.uuid = uuid;
      this.value = null;
    }

    async startNotifications() {
      if (!this.device.gatt.connected) throw networkError();
      this.device.notify(this);
      return this;
    }

    async writeValueWithResponse(data) {
      if (!this.device.gatt.connected) throw networkError();
      const view = ArrayBuffer.isView(data) ? data : new Uint8Array(data);
      const bytes = new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
      await sleep(15);
      control.writes.push(bytes);
      control.treadmill.receive(bytes);
    }
  }

  class Service {
    constructor(device) {
      this.device = device;
    }

    async getCharacteristic(uuid) {
      const characteristic = this.device.characteristics[uuid];
      if (!characteristic) throw new DOMException('No Characteristics matching UUID found.', 'NotFoundError');
      return characteristic;
    }
  }

  class Gatt {
    connected = false;

    constructor(device) {
      this.device = device;
    }

    async connect() {
      await sleep(200);
      if (!control.reachable) throw new DOMException('Connection failed for unknown reason.', 'NetworkError');
      this.connected = true;
      return this;
    }

    disconnect() {
      this.device.stopNotifying();
      if (!this.connected) return;
      this.connected = false;
      this.device.dispatchEvent(new Event('gattserverdisconnected'));
    }

    async getPrimaryService(uuid) {
      if (!this.connected) throw networkError();
      if (uuid !== SERVICE) throw new DOMException('No Services matching UUID found.', 'NotFoundError');
      return new Service(this.device);
    }
  }

  class Device extends EventTarget {
    id = 'mock-pitpat-1';
    name = 'PitPat-T01';
    timer = 0;

    constructor() {
      super();
      this.gatt = new Gatt(this);
      this.characteristics = { [COMMAND]: new Characteristic(this, COMMAND), [STATUS]: new Characteristic(this, STATUS) };
    }

    notify(characteristic) {
      clearInterval(this.timer);
      this.timer = setInterval(() => {
        control.treadmill.tick(500);
        if (!control.sending) return;
        characteristic.value = new DataView(control.treadmill.statusFrame().buffer);
        characteristic.dispatchEvent(new Event('characteristicvaluechanged'));
      }, 500);
    }

    stopNotifying() {
      clearInterval(this.timer);
    }

    drop() {
      this.gatt.disconnect();
    }
  }

  Object.defineProperty(navigator, 'bluetooth', {
    configurable: true,
    value: {
      async requestDevice(options) {
        control.lastRequest = options;
        await sleep(50);
        if (control.chooserCancels) throw new DOMException('User cancelled the requestDevice() chooser.', 'NotFoundError');
        const { SimulatedTreadmill } = await import('/test/support/treadmill-sim.js');
        control.treadmill ??= new SimulatedTreadmill();
        control.device ??= new Device();
        return control.device;
      },
      async getAvailability() {
        return true;
      },
    },
  });
})();
