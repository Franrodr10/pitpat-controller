import { RunState } from './core/protocol.js';
import * as format from './format.js';
import { Alert, Link, Message } from './manager.js';
import { WakeLockStatus } from './wake-lock.js';

const MESSAGES = {
  [Message.NOT_CONNECTED]: 'Sin conexión con la cinta. Usa el mando.',
  [Message.NO_DATA]: 'Esperando datos de la cinta…',
  [Message.RECONNECTED]: 'Reconectado. La app no ha enviado ningún comando.',
  [Message.INCOMPATIBLE]: 'Ese dispositivo no es una cinta compatible.',
  [Message.CHOOSER_FAILED]: 'No se pudo buscar la cinta. Comprueba que el Bluetooth está activado.',
};

const ALERTS = {
  [Alert.LINK_LOST]: 'Conexión perdida. Reconectando…',
  [Alert.LINK_LOST_WHILE_MOVING]: 'Conexión perdida: la cinta sigue en marcha. Usa el mando para pararla.',
  [Alert.STOP_NOT_CONFIRMED]: 'La cinta no confirma la parada. Párala con el mando.',
};

const STATES = {
  [RunState.STOPPED]: 'Parada',
  [RunState.STARTING]: 'Arrancando…',
  [RunState.RUNNING]: 'En marcha',
  [RunState.PAUSED]: 'En pausa',
};

const WAKE_LOCK = {
  [WakeLockStatus.ON]: 'Activada mientras hay conexión con la cinta.',
  [WakeLockStatus.OFF]: 'Se activa al conectar con la cinta.',
  [WakeLockStatus.UNSUPPORTED]: 'Este navegador no puede mantener la pantalla encendida: desactiva el bloqueo ' +
    'automático mientras caminas (en iPhone, Ajustes › Pantalla y brillo › Bloqueo automático › Nunca).',
  [WakeLockStatus.FAILED]: 'El navegador no ha dejado mantener la pantalla encendida: desactiva el bloqueo ' +
    'automático mientras caminas (en iPhone, Ajustes › Pantalla y brillo › Bloqueo automático › Nunca).',
};

/** Android rejects shares bigger than about 1 MB, so only the end of a long log is shared. */
const MAX_SHARED_CHARS = 400_000;

const VIEWS = { '#ajustes': 'settings', '#registro': 'log' };

/**
 * Builds the page from the manager's state. Plain DOM: every value is set with textContent, so
 * nothing coming from Bluetooth is ever parsed as HTML.
 *
 * @param {object} deps
 * @param {import('./manager.js').TreadmillManager} deps.manager
 * @param {import('./settings.js').Settings} deps.settings
 * @param {import('./log.js').DiagnosticsLog} deps.log
 * @param {import('./alarm.js').Alarm} deps.alarm
 * @param {import('./wake-lock.js').ScreenWakeLock} deps.wakeLock
 * @param {import('./ble.js').WebBluetoothTransport} deps.transport
 * @param {string} deps.version
 */
export function startUi({ manager, settings, log, alarm, wakeLock, transport, version }) {
  const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

  if (!transport.available) {
    showUnsupported($);
    return;
  }

  // Sound is only allowed after a tap: every tap unlocks it for the alarm.
  document.addEventListener('click', () => alarm.unlock(), { capture: true });

  // ---------------------------------------------------------------- control screen

  $('welcome-button').addEventListener('click', () => connectOrChoose());
  $('dismiss').addEventListener('click', () => manager.dismissAlert());
  $('main').addEventListener('click', () => manager.startOrPause());
  $('stop').addEventListener('click', () => manager.stop());
  for (const button of document.querySelectorAll('[data-delta]')) {
    button.addEventListener('click', () => manager.changeSpeed(Number(/** @type {HTMLElement} */ (button).dataset.delta)));
  }

  function connectOrChoose() {
    if (manager.state.link === Link.NO_DEVICE) manager.choose();
    else manager.connect();
  }

  function renderPresets() {
    const container = $('presets');
    container.replaceChildren(...settings.presets.map((kmh) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = format.preset(kmh);
      button.dataset.kmh = String(kmh);
      button.setAttribute('aria-label', `${format.speed(kmh)} km/h`);
      button.addEventListener('click', () => manager.selectSpeed(kmh));
      return button;
    }));
  }

  /** @param {import('./manager.js').State} state */
  function render(state) {
    const status = state.status;
    const [linkText, linkColor] = linkLabel(state);
    $('link-text').textContent = linkText;
    $('link-dot').dataset.color = linkColor;
    $('device-name').textContent = state.deviceName ?? '';

    // Choosing or reconnecting the treadmill: browsers only open their list of devices after a tap.
    $('welcome').hidden = state.link !== Link.NO_DEVICE && state.link !== Link.DISCONNECTED;
    $('welcome-text').textContent = state.link === Link.NO_DEVICE
      ? 'Enciende la cinta, cierra la app PitPat (la cinta solo admite una conexión) y elige tu cinta en la lista.'
      : `Pulsa Conectar y elige ${state.deviceName ?? 'tu cinta'} en la lista.`;
    $('welcome-button').textContent = state.link === Link.NO_DEVICE ? 'Elegir cinta' : 'Conectar';

    $('alert').hidden = state.alert === null;
    $('alert-text').textContent = state.alert ? ALERTS[state.alert] : '';

    const speed = $('speed');
    speed.textContent = status ? format.speed(status.speedKmh) : '–';
    speed.classList.toggle('stale', !(status && state.fresh));
    $('state-line').textContent =
      `${status ? STATES[status.state] : 'Sin datos'} · objetivo ${format.speed(state.targetKmh)} km/h`;

    $('metric-time').textContent = status ? format.duration(status.durationSeconds) : '–';
    $('metric-distance').textContent = status ? format.distance(status.distanceKm) : '–';
    $('metric-steps').textContent = state.steps ? (state.steps.estimated ? '≈' : '') + format.count(state.steps.count) : '–';
    $('metric-steps-label').textContent = state.steps?.estimated ? 'pasos (estimados)' : 'pasos';
    $('metric-kcal').textContent = status ? format.count(status.kcal) : '–';

    for (const button of $('presets').children) {
      const kmh = Number(/** @type {HTMLElement} */ (button).dataset.kmh);
      button.classList.toggle('selected', Math.abs(kmh - state.targetKmh) < 0.05);
    }

    renderMainButton(state);
    $('settings-device').textContent = state.deviceName ?? 'Ninguna';
    /** @type {HTMLButtonElement} */ ($('forget-device')).disabled = state.link === Link.NO_DEVICE;
  }

  /** @param {import('./manager.js').State} state */
  function renderMainButton(state) {
    const runState = state.status?.state;
    const connected = state.link === Link.CONNECTED && runState !== undefined;
    let label = 'INICIO';
    let color = 'go';
    if (connected && runState === RunState.RUNNING) [label, color] = ['PAUSA', 'pause'];
    else if (connected && runState === RunState.STARTING) [label, color] = ['ARRANCANDO…', 'pause'];
    else if (connected && runState === RunState.PAUSED) label = 'REANUDAR';
    const button = /** @type {HTMLButtonElement} */ ($('main'));
    button.className = `main ${color}`;
    button.disabled = !connected || runState === RunState.STARTING;
    $('main-label').textContent = label;
    $('main-target').textContent = label === 'INICIO' || label === 'REANUDAR' ? `a ${format.speed(state.targetKmh)} km/h` : '';
  }

  // ---------------------------------------------------------------- toasts

  let toastTimer = 0;
  /** @param {string} text */
  function showToast(text) {
    const toast = $('toast');
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.hidden = true;
    }, 4_000);
  }
  manager.onMessage((message) => showToast(MESSAGES[message] ?? message));

  // ---------------------------------------------------------------- settings

  const presetInputs = Array.from({ length: settings.presets.length }, (_, index) => {
    const input = document.createElement('input');
    input.inputMode = 'decimal';
    input.autocomplete = 'off';
    input.setAttribute('aria-label', `Velocidad rápida ${index + 1}`);
    input.addEventListener('input', validatePresets);
    return input;
  });
  $('preset-inputs').replaceChildren(...presetInputs);

  function fillPresetForm() {
    settings.presets.forEach((kmh, index) => {
      presetInputs[index].value = format.preset(kmh);
    });
    validatePresets();
  }

  /** @returns {number[] | null} the presets typed, or null if any is wrong */
  function validatePresets() {
    const { min, max } = manager.state.speedRange;
    $('presets-range').textContent = `Entre ${format.speed(min)} y ${format.speed(max)} km/h, con un decimal.`;
    const values = presetInputs.map((input) => {
      const value = format.parseSpeed(input.value);
      const valid = value !== null && value >= min && value <= max;
      input.setAttribute('aria-invalid', String(!valid));
      return valid ? value : null;
    });
    const complete = values.every((value) => value !== null);
    const changed = values.some((value, index) => value !== settings.presets[index]);
    /** @type {HTMLButtonElement} */ ($('presets-save')).disabled = !complete || !changed;
    return complete ? /** @type {number[]} */ (values) : null;
  }

  $('presets-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const values = validatePresets();
    if (!values) return;
    settings.presets = values;
    renderPresets();
    render(manager.state);
    validatePresets();
  });

  const keepAlive = /** @type {HTMLInputElement} */ ($('keep-alive'));
  keepAlive.checked = settings.keepAlive;
  keepAlive.addEventListener('change', () => {
    settings.keepAlive = keepAlive.checked;
  });

  $('change-device').addEventListener('click', async () => {
    if (await manager.choose()) location.hash = '';
  });
  $('forget-device').addEventListener('click', async () => {
    await manager.forget();
    location.hash = '';
  });

  const renderWakeLock = () => {
    $('wake-lock-text').textContent = WAKE_LOCK[wakeLock.status];
  };
  wakeLock.subscribe(renderWakeLock);
  renderWakeLock();
  $('version').textContent = version;

  // ---------------------------------------------------------------- log

  const renderLog = () => {
    if ($('log').hidden) return;
    const lines = $('log-lines');
    lines.textContent = log.snapshot().join('\n');
    window.scrollTo(0, document.body.scrollHeight);
  };
  log.subscribe(renderLog);
  $('log-clear').addEventListener('click', () => log.clear());
  $('log-share').addEventListener('click', async () => {
    const result = await shareLog(log.snapshot().join('\n').slice(-MAX_SHARED_CHARS));
    if (result === 'copied') showToast('Registro copiado: pégalo donde quieras enviarlo.');
  });

  // ---------------------------------------------------------------- navigation

  function route() {
    const view = VIEWS[location.hash] ?? 'control';
    for (const id of ['control', 'settings', 'log']) $(id).hidden = id !== view;
    document.body.dataset.view = view;
    $('main').hidden = view !== 'control';
    if (view === 'settings') fillPresetForm();
    if (view === 'log') renderLog();
  }

  window.addEventListener('hashchange', route);
  $('controls').hidden = false;
  renderPresets();
  manager.subscribe(render);
  render(manager.state);
  route();
}

/** @param {import('./manager.js').State} state */
function linkLabel(state) {
  switch (state.link) {
    case Link.NO_DEVICE: return ['Sin cinta elegida', 'muted'];
    case Link.DISCONNECTED: return ['Desconectado', 'stop'];
    case Link.CONNECTING: return ['Conectando…', 'pause'];
    case Link.RECONNECTING: return [`Reconectando (intento ${state.attempt})…`, 'pause'];
    default: return state.fresh ? ['Conectado', 'go'] : ['Conectado, sin datos', 'pause'];
  }
}

/**
 * The share sheet where there is one, else the clipboard, else a text file.
 *
 * @param {string} text
 * @returns {Promise<'shared' | 'copied' | 'downloaded'>}
 */
async function shareLog(text) {
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Registro de PitPat Controller', text });
      return 'shared';
    }
  } catch (error) {
    if (/** @type {any} */ (error)?.name === 'AbortError') return 'shared'; // closed the share sheet
  }
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    // no clipboard either: download it
  }
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  link.download = `pitpat-registro-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.txt`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
  return 'downloaded';
}

/** @param {(id: string) => HTMLElement} $ */
function showUnsupported($) {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  $('unsupported').hidden = false;
  $('unsupported-ios').hidden = !ios;
  $('unsupported-other').hidden = ios;
  $('unsupported-insecure').hidden = window.isSecureContext;
  $('page-url').textContent = location.href;
  $('copy-url').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      $('copy-url').textContent = 'Copiado';
    } catch {
      $('copy-url').textContent = 'Selecciona el enlace y cópialo';
    }
  });
}
