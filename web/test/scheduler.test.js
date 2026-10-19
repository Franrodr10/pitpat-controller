import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CommandKind, CommandScheduler } from '../app/js/core/scheduler.js';

const command = (kind, label) => ({ kind, frame: new Uint8Array(0), label });

const drain = (scheduler) => {
  const labels = [];
  for (let next = scheduler.next(); next !== null; next = scheduler.next()) labels.push(next.label);
  return labels;
};

test('STOP goes first and discards what was waiting', () => {
  const scheduler = new CommandScheduler();
  scheduler.submit(command(CommandKind.CONTROL, 'start'));
  scheduler.submit(command(CommandKind.SPEED, 'speed'));
  scheduler.submit(command(CommandKind.STOP, 'stop'));
  scheduler.submit(command(CommandKind.CONTROL, 'start again'));
  assert.deepEqual(drain(scheduler), ['stop', 'start again']);
});

test('consecutive speed changes collapse into the latest', () => {
  const scheduler = new CommandScheduler();
  scheduler.submit(command(CommandKind.SPEED, '3.0'));
  scheduler.submit(command(CommandKind.SPEED, '3.5'));
  scheduler.submit(command(CommandKind.CONTROL, 'pause'));
  scheduler.submit(command(CommandKind.SPEED, '4.0'));
  assert.deepEqual(drain(scheduler), ['3.5', 'pause', '4.0']);
});

test('keep-alive is only queued when nothing else is waiting', () => {
  const scheduler = new CommandScheduler();
  scheduler.submit(command(CommandKind.CONTROL, 'start'));
  scheduler.submit(command(CommandKind.KEEP_ALIVE, 'keep-alive'));
  assert.deepEqual(drain(scheduler), ['start']);
  scheduler.submit(command(CommandKind.KEEP_ALIVE, 'keep-alive'));
  scheduler.submit(command(CommandKind.KEEP_ALIVE, 'keep-alive'));
  assert.deepEqual(drain(scheduler), ['keep-alive']);
  assert.equal(scheduler.next(), null);
});
