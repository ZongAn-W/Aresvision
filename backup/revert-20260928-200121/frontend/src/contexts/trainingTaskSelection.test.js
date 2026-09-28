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

test('falls back to the latest record when nothing is running', () => {
  // 进入训练页默认展示最新一条记录（列表由服务端按创建时间倒序返回），
  // 因此结果面板不会停在空白状态。
  assert.equal(
    reconcileActiveTrainingTaskId([{ id: 11, status: 'failed' }], 99),
    11
  );
  assert.equal(
    reconcileActiveTrainingTaskId(
      [{ id: 21, status: 'completed' }, { id: 20, status: 'completed' }],
      null
    ),
    21
  );
});

test('a running task still wins over the newest completed record', () => {
  // 运行中的实验优先自动进入监控，不能被最新完成记录顶掉。
  assert.equal(
    reconcileActiveTrainingTaskId(
      [{ id: 30, status: 'completed' }, { id: 29, status: 'running' }],
      null
    ),
    29
  );
});

test('an empty or missing list selects nothing', () => {
  assert.equal(reconcileActiveTrainingTaskId([], null), null);
  assert.equal(reconcileActiveTrainingTaskId(null, 5), null);
});

test('creating a new experiment also suppresses the latest-record fallback', () => {
  // 否则每 5 秒一次的轮询会把用户从配置画布拽到最新一条记录的结果页。
  assert.equal(
    reconcileActiveTrainingTaskId(
      [{ id: 41, status: 'completed' }],
      null,
      { suppressAutoSelect: true }
    ),
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
