import test from 'node:test';
import assert from 'node:assert/strict';

import { reconcileActiveTrainingTaskId } from './trainingTaskSelection.js';


const tasks = [
  { id: 11, status: 'completed' },
  { id: 12, status: 'running' },
];

test('keeps a preferred task when it remains accessible', () => {
  assert.equal(reconcileActiveTrainingTaskId(tasks, 11), 11);
});

test('falls back to a running task when the preferred task was deleted', () => {
  assert.equal(reconcileActiveTrainingTaskId(tasks, 99), 12);
});

test('clears an inaccessible task when no task is running', () => {
  assert.equal(
    reconcileActiveTrainingTaskId([{ id: 11, status: 'failed' }], 99),
    null
  );
});

test('never auto-selects a running task while the user is creating a new experiment', () => {
  // 抑制期间不能自动选中运行中任务，否则任务轮询会把用户拽回监控阶段。
  assert.equal(
    reconcileActiveTrainingTaskId(tasks, null, { suppressAutoSelect: true }),
    null
  );
  assert.equal(
    reconcileActiveTrainingTaskId(tasks, 99, { suppressAutoSelect: true }),
    null
  );
});

test('an explicitly selected task stays selected even while auto-select is suppressed', () => {
  assert.equal(
    reconcileActiveTrainingTaskId(tasks, 11, { suppressAutoSelect: true }),
    11
  );
  assert.equal(
    reconcileActiveTrainingTaskId(tasks, 12, { suppressAutoSelect: true }),
    12
  );
});
