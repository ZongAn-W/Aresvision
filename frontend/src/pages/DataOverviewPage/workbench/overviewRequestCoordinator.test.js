import test from 'node:test';
import assert from 'node:assert/strict';

import { createOverviewCoordinator } from './overviewRequestCoordinator.js';

test('a new request on the same channel aborts the previous one', () => {
  const coordinator = createOverviewCoordinator();
  const first = coordinator.start('field', 'earth|TO3|2020-01-01');
  assert.equal(first.signal.aborted, false);

  const second = coordinator.start('field', 'earth|TO3|2020-01-02');
  assert.equal(first.signal.aborted, true, 'the older field request must be aborted');
  assert.equal(second.signal.aborted, false);

  // Even a fetch implementation that ignores AbortSignal cannot write back:
  // the token/identity pair no longer matches the channel entry.
  assert.equal(coordinator.settle(first), false);
  assert.equal(coordinator.settle(second), true);
});

test('settle rejects a response whose identity no longer matches the channel', () => {
  const coordinator = createOverviewCoordinator();
  const request = coordinator.start('regional', 'earth|regional|TO3');
  assert.equal(coordinator.settle({ ...request, identity: 'earth|regional|T2M' }), false);
  assert.equal(coordinator.settle({ ...request, channel: 'point' }), false);
  assert.equal(coordinator.settle({ ...request, token: request.token + 99 }), false);
  assert.equal(coordinator.settle(null), false);
  assert.equal(coordinator.settle(request), true);
});

test('cancelAll represents a planet switch: every in-flight channel is aborted and unusable', () => {
  const coordinator = createOverviewCoordinator();
  const source = coordinator.start('source', 'earth');
  const field = coordinator.start('field', 'earth|field');
  const regional = coordinator.start('regional', 'earth|regional');
  const point = coordinator.start('point', 'earth|point');
  const card = coordinator.start('card:polar', 'earth|polar');

  coordinator.cancelAll();

  for (const request of [source, field, regional, point, card]) {
    assert.equal(request.signal.aborted, true, `${request.channel} must be aborted`);
    assert.equal(coordinator.settle(request), false, `${request.channel} must not settle`);
  }
});

test('cancelAll also covers dynamically registered card channels', () => {
  const coordinator = createOverviewCoordinator();
  const suite = coordinator.start('card:globalTrend', 'earth|suite');
  const spatial = coordinator.start('card:wave', 'earth|spatial');
  coordinator.cancelAll();
  assert.equal(suite.signal.aborted, true);
  assert.equal(spatial.signal.aborted, true);
  assert.ok(coordinator.channels().includes('card:globalTrend'));
});

test('a channel can be restarted after cancellation without reviving the old request', () => {
  const coordinator = createOverviewCoordinator();
  const first = coordinator.start('field', 'earth|a');
  coordinator.cancel('field');
  const second = coordinator.start('field', 'earth|b');
  assert.equal(second.signal.aborted, false);
  assert.equal(coordinator.settle(first), false);
  assert.equal(coordinator.settle(second), true);
  // Cancelling an unknown channel is a no-op rather than a crash.
  coordinator.cancel('does-not-exist');
});

test('cross-planet responses cannot settle into the new planet channel', () => {
  const coordinator = createOverviewCoordinator();
  const marsField = coordinator.start('field', 'mars|o3col|120');
  // Planet switch: cancel everything, then start the Earth channel.
  coordinator.cancelAll();
  const earthField = coordinator.start('field', 'earth|TO3|2020-01-01');
  assert.equal(coordinator.settle(marsField), false);
  assert.equal(coordinator.settle(earthField), true);
});
