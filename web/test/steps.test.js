import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RunState } from '../app/js/core/protocol.js';
import { StepEstimator } from '../app/js/core/steps.js';

const status = (distanceKm, durationS, steps = 0, speed = 4.0) => ({
  state: RunState.RUNNING, speedKmh: speed, targetSpeedKmh: speed, distanceKm,
  durationSeconds: durationS, steps, kcal: 0, maxSpeedKmh: 6.0,
});

const between = (value, min, max) => assert.ok(value >= min && value <= max, `got ${value}`);

test('uses the treadmill count once it reports steps', () => {
  const estimator = new StepEstimator();
  assert.deepEqual(estimator.update(status(0.2, 180, 321)), { count: 321, estimated: false });
  assert.deepEqual(estimator.update(status(0.0, 0, 0)), { count: 0, estimated: false });
});

test('estimates steps from distance at walking cadence', () => {
  const estimator = new StepEstimator();
  estimator.update(status(0.0, 0));
  const steps = estimator.update(status(1.0, 900)); // 1 km at 4 km/h
  assert.ok(steps.estimated);
  // At 4 km/h: 104 steps/min and 0.64 m per step, so about 1560 steps per km.
  between(steps.count, 1500, 1620);
});

test('starts from the distance already walked and restarts with a new session', () => {
  const estimator = new StepEstimator();
  between(estimator.update(status(0.5, 450)).count, 750, 810);
  assert.equal(estimator.update(status(0.0, 0)).count, 0);
});

test('cadence grows with speed', () => {
  assert.ok(Math.abs(StepEstimator.cadence(3.0) - 93.5) < 0.001);
  assert.ok(Math.abs(StepEstimator.cadence(6.0) - 125.0) < 0.001);
});
