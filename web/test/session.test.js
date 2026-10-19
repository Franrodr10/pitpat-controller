import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PitPatProtocol as protocol } from '../app/js/core/pitpat.js';
import { RunState } from '../app/js/core/protocol.js';
import { CommandKind } from '../app/js/core/scheduler.js';
import { Notice, SessionController } from '../app/js/core/session.js';

const { STOPPED, STARTING, RUNNING, PAUSED } = RunState;

const status = (state, speed = 0.0, target = speed, max = 6.0) => ({
  state, speedKmh: speed, targetSpeedKmh: target, distanceKm: 0, durationSeconds: 0, steps: 0, kcal: 0, maxSpeedKmh: max,
});

/** The frame of an outcome that must carry exactly one command. */
const frame = (outcome) => {
  assert.equal(outcome.commands.length, 1);
  return outcome.commands[0].frame;
};

test('without a connection nothing is sent and the user is told', () => {
  const controller = new SessionController(protocol, 2.0);
  assert.equal(controller.stop(false, 0).notice, Notice.NOT_CONNECTED);
  assert.equal(controller.startOrPause(false, 0).notice, Notice.NOT_CONNECTED);
  assert.deepEqual(controller.selectSpeed(4.0, false, 0).commands, []);
  assert.equal(controller.targetKmh, 4.0);
});

test('start needs fresh data from the treadmill', () => {
  const controller = new SessionController(protocol, 2.0);
  assert.equal(controller.startOrPause(true, 0).notice, Notice.NO_DATA);
  controller.onStatus(status(STOPPED), 0);
  assert.equal(controller.startOrPause(true, 10_000).notice, Notice.NO_DATA);
});

test('start sends the target and corrects it once if the treadmill uses its own speed', () => {
  const controller = new SessionController(protocol, 3.0);
  controller.onStatus(status(STOPPED), 0);
  assert.deepEqual(frame(controller.startOrPause(true, 100)), protocol.startFrame(3.0));
  assert.deepEqual(controller.onStatus(status(STARTING), 1_000).commands, []);
  assert.deepEqual(frame(controller.onStatus(status(RUNNING, 1.0), 4_000)), protocol.speedFrame(3.0));
  assert.deepEqual(controller.onStatus(status(RUNNING, 1.0), 4_500).commands, []);
});

test('no correction when the treadmill honours the start speed', () => {
  const controller = new SessionController(protocol, 3.0);
  controller.onStatus(status(PAUSED), 0);
  controller.startOrPause(true, 100);
  assert.deepEqual(controller.onStatus(status(RUNNING, 3.0), 3_000).commands, []);
});

test('the main button pauses while running and does nothing during the countdown', () => {
  const controller = new SessionController(protocol, 3.0);
  controller.onStatus(status(STARTING), 0);
  assert.deepEqual(controller.startOrPause(true, 100).commands, []);
  controller.onStatus(status(RUNNING, 3.0), 200);
  assert.deepEqual(frame(controller.startOrPause(true, 300)), protocol.pauseFrame());
});

test('speed changes are only sent while running with fresh data', () => {
  const controller = new SessionController(protocol, 2.0);
  controller.onStatus(status(STOPPED), 0);
  assert.deepEqual(controller.changeSpeed(0.5, true, 100).commands, []);
  assert.equal(controller.targetKmh, 2.5);
  controller.onStatus(status(RUNNING, 2.5), 200);
  assert.deepEqual(frame(controller.changeSpeed(0.5, true, 300)), protocol.speedFrame(3.0));
  assert.deepEqual(controller.changeSpeed(0.5, true, 10_000).commands, []);
});

test('speeds stay between the protocol minimum and the treadmill maximum', () => {
  const controller = new SessionController(protocol, 2.0);
  controller.onStatus(status(RUNNING, 3.0, 3.0, 5.0), 0);
  assert.deepEqual(frame(controller.selectSpeed(9.0, true, 10)), protocol.speedFrame(5.0));
  assert.deepEqual(frame(controller.changeSpeed(-10.0, true, 20)), protocol.speedFrame(1.0));
  controller.changeSpeed(0.5, true, 30);
  controller.changeSpeed(0.1, true, 40);
  assert.equal(controller.targetKmh, 1.6);
});

test('a speed chosen during the countdown is applied once running', () => {
  const controller = new SessionController(protocol, 2.0);
  controller.onStatus(status(STOPPED), 0);
  controller.startOrPause(true, 10);
  controller.onStatus(status(STARTING), 500);
  assert.deepEqual(controller.selectSpeed(4.0, true, 600).commands, []);
  assert.deepEqual(frame(controller.onStatus(status(RUNNING, 2.0), 3_000)), protocol.speedFrame(4.0));
});

test('follows the remote control, but not right after a change in the app', () => {
  const controller = new SessionController(protocol, 2.0);
  controller.onStatus(status(RUNNING, 3.0), 0);
  assert.equal(controller.targetKmh, 3.0);
  controller.selectSpeed(4.0, true, 1_000);
  controller.onStatus(status(RUNNING, 3.0), 1_500);
  assert.equal(controller.targetKmh, 4.0);
  controller.onStatus(status(RUNNING, 3.6), 5_000);
  assert.equal(controller.targetKmh, 3.6);
});

test('STOP is always sent, even with stale or no data', () => {
  const controller = new SessionController(protocol, 2.0);
  const { commands } = controller.stop(true, 0);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].kind, CommandKind.STOP);
});

test('STOP is re-sent while the belt keeps moving, then the user is warned', () => {
  const controller = new SessionController(protocol, 2.0);
  controller.onStatus(status(RUNNING, 3.0), 0);
  controller.stop(true, 100);
  assert.deepEqual(controller.onStatus(status(RUNNING, 3.0), 1_000).commands, []);
  assert.deepEqual(controller.onStatus(status(RUNNING, 3.0), 3_200).commands.map((c) => c.kind), [CommandKind.STOP]);
  assert.deepEqual(controller.onStatus(status(RUNNING, 3.0), 6_300).commands.map((c) => c.kind), [CommandKind.STOP]);
  const gaveUp = controller.onStatus(status(RUNNING, 3.0), 9_400);
  assert.deepEqual(gaveUp.commands, []);
  assert.equal(gaveUp.notice, Notice.STOP_NOT_CONFIRMED);
});

test('a stopped belt ends the STOP checks', () => {
  const controller = new SessionController(protocol, 2.0);
  controller.onStatus(status(RUNNING, 3.0), 0);
  controller.stop(true, 100);
  controller.onStatus(status(STOPPED), 800);
  assert.deepEqual(controller.onStatus(status(RUNNING, 1.0), 5_000).commands, []);
});

test('nothing pending survives a dropped link', () => {
  const controller = new SessionController(protocol, 3.0);
  controller.onStatus(status(STOPPED), 0);
  controller.startOrPause(true, 100);
  controller.onLinkDown();
  assert.equal(controller.status, null);
  assert.deepEqual(controller.onStatus(status(RUNNING, 1.0), 2_000).commands, []);
});

test('speeds that are not numbers are refused instead of being sent', () => {
  const controller = new SessionController(protocol, 2.0);
  controller.onStatus(status(RUNNING, 2.0), 0);
  assert.throws(() => controller.selectSpeed(NaN, true, 10), RangeError);
  assert.equal(controller.targetKmh, 2.0);
});
