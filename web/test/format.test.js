import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as format from '../app/js/format.js';

test('speeds use a decimal comma', () => {
  assert.equal(format.speed(3.5), '3,5');
  assert.equal(format.speed(6.0), '6,0');
});

test('presets drop a useless decimal', () => {
  assert.equal(format.preset(4.0), '4');
  assert.equal(format.preset(3.5), '3,5');
});

test('durations show hours only when needed', () => {
  assert.equal(format.duration(754), '12:34');
  assert.equal(format.duration(3_723), '1:02:03');
});

test('counts group thousands like the Android app', () => {
  assert.equal(format.count(1_234), '1.234');
  assert.equal(format.count(56), '56');
});

test('parses speeds typed with comma or dot', () => {
  assert.equal(format.parseSpeed(' 4,5 '), 4.5);
  assert.equal(format.parseSpeed('3'), 3.0);
  assert.equal(format.parseSpeed('3.46'), 3.5);
  assert.equal(format.parseSpeed('rápido'), null);
  assert.equal(format.parseSpeed(''), null);
  assert.equal(format.parseSpeed('-3'), null);
});
