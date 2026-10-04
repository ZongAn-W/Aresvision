import test from 'node:test';
import assert from 'node:assert/strict';
import {
  countExperimentStatuses,
  matchesExperimentStatusFilter,
} from './experimentCenterModel.js';

test('treats queued and cancelled as first-class task states', () => {
    assert.equal(matchesExperimentStatusFilter('queued', 'queued'), true);
    assert.equal(matchesExperimentStatusFilter('running', 'queued'), false);
    assert.equal(matchesExperimentStatusFilter('cancelled', 'cancelled'), true);
  });

test('counts queued and cancelled tasks independently', () => {
    assert.deepEqual(countExperimentStatuses([
      { status: 'queued' },
      { status: 'queued' },
      { status: 'running' },
      { status: 'cancelled' },
    ]), { all: 4, queued: 2, running: 1, completed: 0, failed: 0, cancelled: 1 });
  });
