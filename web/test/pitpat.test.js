import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PitPatProtocol, isValidFrame, parseStatus } from '../app/js/core/pitpat.js';
import { RunState, matchesAdvertisement, toHex, uuid16 } from '../app/js/core/protocol.js';
import { hex, statusFrame } from './support/test-frames.js';

test('control frames match the documented examples', () => {
  assert.equal(toHex(PitPatProtocol.startFrame(2.0)), '6A 17 00 00 00 00 07 D0 01 00 50 00 04 00 00 00 0D BA 9D 76 EF 26 43');
  assert.equal(toHex(PitPatProtocol.speedFrame(3.0)), '6A 17 00 00 00 00 0B B8 05 00 50 00 04 00 00 00 0D BA 9D 76 EF 46 43');
  assert.equal(toHex(PitPatProtocol.speedFrame(4.5)), '6A 17 00 00 00 00 11 94 05 00 50 00 04 00 00 00 0D BA 9D 76 EF 70 43');
  assert.equal(toHex(PitPatProtocol.pauseFrame()), '6A 17 00 00 00 00 00 00 01 00 50 00 02 00 00 00 0D BA 9D 76 EF F7 43');
  assert.equal(toHex(PitPatProtocol.stopFrame()), '6A 17 00 00 00 00 00 00 01 00 50 00 00 00 00 00 0D BA 9D 76 EF F5 43');
  assert.equal(toHex(PitPatProtocol.keepAliveFrame), '6A 05 FD F8 43');
});

test('speed frames never leave the protocol range', () => {
  assert.deepEqual(PitPatProtocol.speedFrame(9.9), PitPatProtocol.speedFrame(6.0));
  assert.deepEqual(PitPatProtocol.startFrame(0.2), PitPatProtocol.startFrame(1.0));
  assert.deepEqual(PitPatProtocol.startFrame(-3.0), PitPatProtocol.startFrame(1.0));
  assert.throws(() => PitPatProtocol.speedFrame(NaN), RangeError);
});

test('checksum agrees with frames published by other projects', () => {
  for (const frame of ['6A05FDF843', '6A05D7D243', '6B059D9843', '6A1700000000000005008A00020000000000122E0CAA43']) {
    assert.ok(isValidFrame(hex(frame)), frame);
  }
});

test('parses the example status frame from PROTOCOL_md', () => {
  const frame = hex(
    '68 34 00 0D AC 0D AC 00 00 04 D2 00 00 00 00 00 05 F0 00 38 00 0B 81 50' +
      '2A 1B 08 17 70 00 05 00 45 58 41 4D 50 4C 45 2D 53 45 52 49 41 4C 30 30 00 00 CB 43',
  );
  assert.deepEqual(parseStatus(frame), {
    state: RunState.RUNNING, speedKmh: 3.5, targetSpeedKmh: 3.5, distanceKm: 1.234,
    durationSeconds: 754, steps: 1520, kcal: 56, maxSpeedKmh: 6.0,
  });
});

test('decodes every run state', () => {
  const states = [[0x00, RunState.STOPPED], [0x18, RunState.STARTING], [0x08, RunState.RUNNING], [0x10, RunState.PAUSED]];
  for (const [flags, state] of states) {
    // Other flag bits (units, Wi-Fi, bracelet) must not change the state.
    assert.equal(parseStatus(statusFrame({ flags: flags | 0xe1 }))?.state, state);
  }
});

test('duration is in seconds on firmware 19 and older', () => {
  assert.equal(parseStatus(statusFrame({ durationRaw: 754, firmware: 19 }))?.durationSeconds, 754);
  assert.equal(parseStatus(statusFrame({ durationRaw: 754_999, firmware: 20 }))?.durationSeconds, 754);
});

test('rejects corrupted and short frames', () => {
  const frame = statusFrame();
  const corrupted = frame.slice();
  corrupted[4] += 1;
  assert.equal(parseStatus(corrupted), null);
  assert.equal(parseStatus(frame.slice(0, 30)), null);
  assert.equal(parseStatus(PitPatProtocol.keepAliveFrame), null);
});

test('decoder reassembles notifications split by the default MTU', () => {
  const decoder = PitPatProtocol.newDecoder();
  const frame = statusFrame({ speed: 4200 });
  const statuses = [];
  for (let i = 0; i < frame.length; i += 20) {
    statuses.push(...decoder(PitPatProtocol.statusCharacteristics[0], frame.slice(i, i + 20), 0));
  }
  assert.deepEqual(statuses.map((status) => status.speedKmh), [4.2]);
});

test('recognises PitPat advertisements', () => {
  assert.ok(matchesAdvertisement(PitPatProtocol, 'PitPat-T01', []));
  assert.ok(matchesAdvertisement(PitPatProtocol, null, [uuid16(0xfba0)]));
  assert.ok(matchesAdvertisement(PitPatProtocol, '', [uuid16(0x1910)]));
  assert.ok(!matchesAdvertisement(PitPatProtocol, 'Walkingpad', [uuid16(0x1826)]));
});
