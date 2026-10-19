import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WriteResult } from '../app/js/ble.js';
import { PitPatProtocol } from '../app/js/core/pitpat.js';
import { RunState } from '../app/js/core/protocol.js';
import { DiagnosticsLog } from '../app/js/log.js';
import { Alert, Link, Message, TreadmillManager } from '../app/js/manager.js';
import { Settings } from '../app/js/settings.js';
import { FakeClock } from './support/fake-clock.js';
import { FakeTransport } from './support/fake-transport.js';

function setup({ keepAlive = true } = {}) {
  const clock = new FakeClock();
  const transport = new FakeTransport(clock);
  const settings = new Settings(null);
  settings.keepAlive = keepAlive;
  const log = new DiagnosticsLog();
  const alarm = { count: 0, alert() { this.count++; } };
  const manager = new TreadmillManager({ transport, settings, log, alarm, clock });
  const messages = [];
  manager.onMessage((message) => messages.push(message));
  return { clock, transport, settings, log, alarm, manager, messages };
}

/** Chooses the simulated treadmill and waits for its first status. */
async function connected(options) {
  const env = setup(options);
  await env.manager.choose();
  await env.clock.advance(700);
  assert.equal(env.manager.state.link, Link.CONNECTED);
  return env;
}

/** Starts the belt and waits until it runs at the target speed. */
async function running(env, kmh = 3.0) {
  env.manager.selectSpeed(kmh);
  env.manager.startOrPause();
  await env.clock.advance(9_000);
  assert.equal(env.manager.state.status?.state, RunState.RUNNING);
}

const isStop = (frame) => frame.length === 23 && frame[12] === 0x00;
const keepAlives = (transport) => transport.treadmill.received.filter((frame) => frame.length === 5).length;

test('connects to the chosen treadmill and shows its status', async () => {
  const { manager, settings } = await connected();
  assert.equal(manager.state.deviceName, 'PitPat-T01');
  assert.equal(manager.state.status?.state, RunState.STOPPED);
  assert.ok(manager.state.fresh);
  assert.equal(settings.deviceId, 'sim-1');
  assert.equal(settings.protocolName, 'PitPat');
});

test('START reaches the treadmill and the belt runs at the target speed', async () => {
  const env = await connected();
  await running(env, 3.0);
  assert.deepEqual(env.transport.commands()[0], PitPatProtocol.startFrame(3.0));
  await env.clock.advance(5_000);
  assert.equal(env.manager.state.status?.speedKmh, 3.0);
  assert.equal(env.manager.state.targetKmh, 3.0);
});

test('a keep-alive goes out every second while idle, and none when it is disabled', async () => {
  const on = await connected();
  await on.clock.advance(5_000);
  assert.ok(keepAlives(on.transport) >= 4, `got ${keepAlives(on.transport)}`);

  const off = await connected({ keepAlive: false });
  await off.clock.advance(5_000);
  assert.equal(keepAlives(off.transport), 0);
});

test('a dropped link warns, and nothing is sent on its own after reconnecting', async () => {
  const env = await connected();
  const { clock, transport, manager, alarm, messages } = env;
  await running(env, 3.0);
  manager.selectSpeed(4.0);
  await clock.advance(1_000);
  const sent = transport.commands().length;

  transport.dropLink();
  await clock.advance(10);
  assert.equal(manager.state.alert, Alert.LINK_LOST_WHILE_MOVING);
  assert.equal(alarm.count, 1);
  assert.equal(manager.state.link, Link.RECONNECTING);
  assert.equal(manager.state.status, null);

  manager.selectSpeed(5.0); // pressed while the link is down: must not be sent later
  manager.startOrPause();
  await clock.advance(5_000);
  assert.equal(manager.state.link, Link.CONNECTED);
  assert.equal(manager.state.alert, null);
  assert.equal(messages.at(-1), Message.RECONNECTED);
  assert.equal(transport.commands().length, sent);
  assert.equal(transport.treadmill.target, 4000); // the belt kept the speed it had
});

test('STOP is retried when the writes fail, then the user is warned', async () => {
  const env = await connected();
  await running(env);
  env.transport.writeResult = WriteResult.FAILED;
  env.manager.stop();
  await env.clock.advance(1_000);
  assert.equal(env.transport.attempted.filter(isStop).length, 4);
  assert.equal(env.manager.state.alert, Alert.STOP_NOT_CONFIRMED);
  assert.equal(env.alarm.count, 1);
});

test('STOP goes out before anything that was waiting and stops the belt', async () => {
  const env = await connected();
  await running(env, 3.0);
  env.manager.selectSpeed(5.0);
  env.manager.stop();
  await env.clock.advance(1_500);
  assert.ok(isStop(env.transport.commands().at(-1)));
  assert.equal(env.manager.state.status?.state, RunState.STOPPED);
});

test('STOP right after the link drops warns instead of waiting for the reconnection', async () => {
  const env = await connected();
  await running(env);
  env.transport.dropLink();
  await env.clock.advance(10);
  env.manager.stop();
  assert.equal(env.messages.at(-1), Message.NOT_CONNECTED);
  assert.equal(env.alarm.count, 2); // the lost link, then STOP without a link
});

test('STOP without a link warns and vibrates', () => {
  const { manager, alarm, messages } = setup();
  manager.stop();
  assert.deepEqual(messages, [Message.NOT_CONNECTED]);
  assert.equal(alarm.count, 1);
});

test('a silent link is restarted by the watchdog', async () => {
  const { clock, transport, manager, log } = await connected();
  transport.sending = false;
  await clock.advance(10_600);
  assert.equal(manager.state.alert, Alert.LINK_LOST);
  assert.match(log.snapshot().join('\n'), /Sin datos de la cinta/);
  transport.sending = true;
  await clock.advance(2_000);
  assert.equal(transport.connectAttempts, 2);
  assert.equal(manager.state.link, Link.CONNECTED);
});

test('failed connections are retried with a growing pause', async () => {
  const { clock, transport, manager } = setup();
  transport.nextConnect = 'fail';
  await manager.choose();
  await clock.advance(30_000);
  // 0.1 s, then pauses of 1, 2, 4, 8 and 10 s between attempts of 0.1 s each.
  assert.equal(transport.connectAttempts, 6);
  assert.equal(manager.state.link, Link.RECONNECTING);
});

test('an incompatible device stops the retries and is forgotten', async () => {
  const { clock, transport, manager, messages, settings } = setup();
  transport.nextConnect = 'incompatible';
  await manager.choose();
  await clock.advance(5_000);
  assert.deepEqual(messages, [Message.INCOMPATIBLE]);
  assert.equal(manager.state.link, Link.NO_DEVICE);
  assert.equal(settings.deviceId, null);
  assert.equal(transport.connectAttempts, 1);
});

test('hiding the page keeps a live link but stops retrying a dead one', async () => {
  const { clock, transport, manager } = await connected();
  await manager.onVisibilityChange(false);
  assert.equal(manager.state.link, Link.CONNECTED);

  transport.nextConnect = 'fail';
  transport.dropLink();
  await clock.advance(10);
  await manager.onVisibilityChange(false);
  assert.equal(manager.state.link, Link.DISCONNECTED);
  assert.equal(manager.state.alert, Alert.LINK_LOST);
  const attempts = transport.connectAttempts;
  await clock.advance(30_000);
  assert.equal(transport.connectAttempts, attempts);

  transport.nextConnect = 'ok';
  await manager.onVisibilityChange(true);
  await clock.advance(700);
  assert.equal(manager.state.link, Link.CONNECTED);
});

test('reconnects on its own to a treadmill the browser remembers', async () => {
  const clock = new FakeClock();
  const transport = new FakeTransport(clock);
  transport.remembersDevices = true;
  const settings = new Settings(null);
  settings.saveDevice('sim-1', 'PitPat-T01');
  const manager = new TreadmillManager({ transport, settings, log: new DiagnosticsLog(), alarm: { alert() {} }, clock });
  assert.equal(manager.state.link, Link.DISCONNECTED);
  await manager.resume();
  await clock.advance(700);
  assert.equal(manager.state.link, Link.CONNECTED);
});

test('forgetting the treadmill closes the link', async () => {
  const { manager, settings, transport } = await connected();
  await manager.forget();
  assert.equal(manager.state.link, Link.NO_DEVICE);
  assert.equal(settings.deviceId, null);
  assert.equal(transport.connection?.open, false);
});
