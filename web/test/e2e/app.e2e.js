// End-to-end tests: the real page in Chromium, with Web Bluetooth replaced by a simulated
// treadmill (bluetooth-mock.js). Run with `npm run test:e2e` from web/.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright';
import { startServer } from './server.js';

const MOCK = fileURLToPath(new URL('./bluetooth-mock.js', import.meta.url));
const IPHONE = devices['iPhone 13'];

/** @type {{url: string, close: () => void}} */
let server;
/** @type {import('playwright').Browser} */
let browser;

before(async () => {
  server = await startServer();
  // In CI, PITPAT_E2E_CHANNEL=chrome uses the runner's Chrome instead of downloading Chromium.
  browser = await chromium.launch({ channel: process.env.PITPAT_E2E_CHANNEL || undefined });
});

after(async () => {
  await browser?.close();
  server?.close();
});

/** Opens the app on a phone-sized screen, with the simulated treadmill unless told otherwise. */
async function openApp({ bluetooth = true, userAgent = undefined } = {}) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent,
  });
  if (bluetooth) await context.addInitScript({ path: MOCK });
  else await context.addInitScript(() => Object.defineProperty(navigator, 'bluetooth', { value: undefined }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error));
  await page.goto(`${server.url}/app/`);
  return { page, context, errors };
}

/** @param {import('playwright').Page} page */
const text = (page, selector) => page.locator(selector).innerText();

/**
 * @param {import('playwright').Page} page
 * @param {string} selector
 * @param {string | RegExp} expected
 */
async function waitForText(page, selector, expected, timeout = 15_000) {
  const matches = typeof expected === 'string' ? (value) => value.trim() === expected : (value) => expected.test(value);
  const deadline = Date.now() + timeout;
  let last = '';
  while (Date.now() < deadline) {
    last = await text(page, selector).catch(() => '');
    if (matches(last)) return;
    await page.waitForTimeout(100);
  }
  assert.fail(`${selector}: expected ${expected}, got "${last}"`);
}

const commands = (page) => page.evaluate(() => window.__bluetooth.commands().map((frame) => Array.from(frame)));
const opOf = (frame) => ({ 0: 'stop', 2: 'pause', 4: frame[8] === 1 ? 'start' : 'speed' })[frame[12]];
const speedOf = (frame) => (frame[6] * 256 + frame[7]) / 1000;

/** @param {import('playwright').Page} page */
async function chooseTreadmill(page) {
  await page.locator('#welcome-button').click();
  await waitForText(page, '#link-text', 'Conectado');
  await waitForText(page, '#state-line', /^Parada/);
}

test('without Web Bluetooth an iPhone is sent to Bluefy', async () => {
  const { page, context } = await openApp({ bluetooth: false, userAgent: IPHONE.userAgent });
  assert.ok(await page.locator('#unsupported').isVisible());
  assert.ok(await page.locator('#unsupported-ios a[href*="apps.apple.com"]').isVisible());
  assert.ok(!(await page.locator('#controls').isVisible()));
  assert.match(await text(page, '#page-url'), /\/app\/$/);
  await context.close();
});

test('chooses the treadmill, starts, changes speed and stops', async () => {
  const { page, context, errors } = await openApp();
  assert.equal((await text(page, '#link-text')).trim(), 'Sin cinta elegida');
  assert.ok(await page.locator('#main').isDisabled());
  assert.ok(await page.locator('#stop').isEnabled());

  await chooseTreadmill(page);
  const request = await page.evaluate(() => window.__bluetooth.lastRequest);
  assert.deepEqual(request.filters, [{ namePrefix: 'PitPat' },
    { services: ['0000fba0-0000-1000-8000-00805f9b34fb'] }, { services: ['00001910-0000-1000-8000-00805f9b34fb'] }]);
  assert.equal((await text(page, '#device-name')).trim(), 'PitPat-T01');

  await page.locator('#presets button', { hasText: /^3$/ }).click();
  await waitForText(page, '#main-target', 'a 3,0 km/h');
  await page.locator('#main').click();
  await waitForText(page, '#main-label', 'ARRANCANDO…');
  await waitForText(page, '#main-label', 'PAUSA');
  await waitForText(page, '#speed', '3,0', 20_000);

  await page.locator('[data-delta="0.5"]').click();
  await waitForText(page, '#speed', '3,5');
  await page.locator('#presets button', { hasText: /^5$/ }).click();
  await waitForText(page, '#state-line', 'En marcha · objetivo 5,0 km/h');

  await page.locator('#stop').click();
  await waitForText(page, '#state-line', /^Parada/);
  const sent = await commands(page);
  assert.deepEqual(sent.map((frame) => [opOf(frame), speedOf(frame)]),
    [['start', 3], ['speed', 3.5], ['speed', 5], ['stop', 0]]);
  assert.ok(Math.max(...sent.map(speedOf)) <= 6.0);
  assert.deepEqual(errors, []);
  await context.close();
});

test('a lost link shows the alert, and nothing is resent after reconnecting', async () => {
  const { page, context, errors } = await openApp();
  await chooseTreadmill(page);
  await page.locator('#main').click();
  await waitForText(page, '#main-label', 'PAUSA');
  const before = (await commands(page)).length;

  await page.evaluate(() => window.__bluetooth.dropLink());
  await waitForText(page, '#alert-text', 'Conexión perdida: la cinta sigue en marcha. Usa el mando para pararla.');
  await waitForText(page, '#link-text', /^Reconectando/);
  await page.locator('[data-delta="0.5"]').click(); // pressed while the link is down

  await waitForText(page, '#link-text', 'Conectado');
  await waitForText(page, '#toast', 'Reconectado. La app no ha enviado ningún comando.');
  assert.ok(await page.locator('#alert').isHidden());
  await page.waitForTimeout(1_500);
  assert.equal((await commands(page)).length, before);
  assert.deepEqual(errors, []);
  await context.close();
});

test('STOP without a link tells the user to use the remote', async () => {
  const { page, context } = await openApp();
  await page.locator('#stop').click();
  await waitForText(page, '#toast', 'Sin conexión con la cinta. Usa el mando.');
  await context.close();
});

test('presets are saved, and only valid ones', async () => {
  const { page, context } = await openApp();
  await page.locator('#control a[href="#ajustes"]').click();
  const inputs = page.locator('#preset-inputs input');
  assert.equal(await inputs.count(), 4);
  assert.ok(await page.locator('#presets-save').isDisabled());

  await inputs.nth(3).fill('9');
  assert.equal(await inputs.nth(3).getAttribute('aria-invalid'), 'true');
  assert.ok(await page.locator('#presets-save').isDisabled());

  for (const [index, value] of ['2,5', '3', '3.5', '4'].entries()) await inputs.nth(index).fill(value);
  await page.locator('#presets-save').click();
  await page.locator('#settings a[href="#"]').click();
  assert.deepEqual(await page.locator('#presets button').allInnerTexts(), ['2,5', '3', '3,5', '4']);

  await page.reload();
  assert.deepEqual(await page.locator('#presets button').allInnerTexts(), ['2,5', '3', '3,5', '4']);
  await context.close();
});

test('after a reload the treadmill is one tap away, and the log can be cleared', async () => {
  const { page, context } = await openApp();
  await chooseTreadmill(page);
  await page.reload();
  await waitForText(page, '#link-text', 'Desconectado');
  await waitForText(page, '#welcome-text', 'Pulsa Conectar y elige PitPat-T01 en la lista.');
  await page.locator('#welcome-button', { hasText: 'Conectar' }).click();
  await waitForText(page, '#link-text', 'Conectado');

  await page.goto(`${server.url}/app/#registro`);
  await waitForText(page, '#log-lines', /PitPat Controller web/);
  await page.locator('#log-clear').click();
  assert.equal(await text(page, '#log-lines'), '');
  assert.ok(await page.locator('#stop').isVisible()); // STOP stays reachable on every screen
  await context.close();
});
