import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FrameReassembler } from '../app/js/core/frame-reassembler.js';
import { statusFrame } from './support/test-frames.js';

const frame = statusFrame();

const join = (...parts) => {
  const out = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

test('complete frames pass straight through', () => {
  assert.deepEqual(new FrameReassembler().feed(frame, 0), [frame]);
});

test('joins a frame split in pieces and keeps two frames in one chunk apart', () => {
  const reassembler = new FrameReassembler();
  assert.deepEqual(reassembler.feed(frame.slice(0, 20), 0), []);
  assert.deepEqual(reassembler.feed(frame.slice(20, 40), 5), []);
  assert.deepEqual(reassembler.feed(frame.slice(40, 52), 10), [frame]);
  assert.equal(reassembler.feed(join(frame, frame), 20).length, 2);
});

test('drops a partial frame that is never completed', () => {
  const reassembler = new FrameReassembler(300);
  reassembler.feed(frame.slice(0, 20), 0);
  assert.deepEqual(reassembler.feed(frame, 1_000), [frame]);
});

test('passes through data without a length byte', () => {
  const odd = Uint8Array.of(0x01, 0x00, 0x7f);
  assert.deepEqual(new FrameReassembler().feed(odd, 0), [odd]);
});
