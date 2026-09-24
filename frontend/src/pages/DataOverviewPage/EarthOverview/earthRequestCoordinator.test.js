import test from 'node:test';
import assert from 'node:assert/strict';

import { createEarthRequestCoordinator } from './earthRequestCoordinator.js';

test('a newer request on the same channel invalidates the older one', () => {
  const coordinator = createEarthRequestCoordinator();
  const first = coordinator.start('field', 'date=2020-01-01');
  const second = coordinator.start('field', 'date=2020-01-02');

  assert.equal(first.signal.aborted, true);
  assert.equal(second.signal.aborted, false);
  assert.equal(coordinator.isCurrent(first, 'date=2020-01-01'), false);
  assert.equal(coordinator.isCurrent(second, 'date=2020-01-02'), true);
});

test('a late response that ignores abort still cannot be applied', () => {
  const coordinator = createEarthRequestCoordinator();
  const slow = coordinator.start('field', 'date=2020-01-01');
  const fast = coordinator.start('field', 'date=2020-01-02');

  // Simulate the slow request resolving after the fast one, with a fetch mock
  // that never honoured the abort signal: the token check must reject it.
  assert.equal(coordinator.settle(slow, 'date=2020-01-01'), false);
  assert.equal(coordinator.settle(fast, 'date=2020-01-02'), true);
});

test('a response whose context changed is rejected even if its token is active', () => {
  const coordinator = createEarthRequestCoordinator();
  const token = coordinator.start('regional-series', 'TO3|2020-01-01|2021-12-31');
  // The user switched variable while the request was in flight.
  assert.equal(coordinator.isCurrent(token, 'T2M|2020-01-01|2021-12-31'), false);
  assert.equal(coordinator.settle(token, 'T2M|2020-01-01|2021-12-31'), false);
});

test('cancelling the field channel leaves the point series channel alone', () => {
  const coordinator = createEarthRequestCoordinator();
  const field = coordinator.start('field', 'a');
  const point = coordinator.start('point-series', 'b');
  const region = coordinator.start('regional-series', 'c');

  coordinator.cancel('field');

  assert.equal(field.signal.aborted, true);
  assert.equal(point.signal.aborted, false);
  assert.equal(region.signal.aborted, false);
  assert.equal(coordinator.isCurrent(point), true);
  assert.equal(coordinator.isCurrent(region), true);
});

test('invalidateAll cancels every channel and drops all tokens', () => {
  const coordinator = createEarthRequestCoordinator();
  const tokens = [
    coordinator.start('field', 'a'),
    coordinator.start('point-series', 'b'),
    coordinator.start('regional-series', 'c'),
  ];

  coordinator.invalidateAll();

  for (const token of tokens) {
    assert.equal(token.signal.aborted, true);
    assert.equal(coordinator.isCurrent(token), false);
    assert.equal(coordinator.settle(token), false);
  }
});

test('independent coordinators never share channel state', () => {
  const one = createEarthRequestCoordinator();
  const two = createEarthRequestCoordinator();
  const first = one.start('field', 'a');
  const second = two.start('field', 'b');

  assert.equal(first.signal.aborted, false);
  assert.equal(second.signal.aborted, false);
  assert.equal(one.isCurrent(first), true);
  assert.equal(two.isCurrent(second), true);
});
