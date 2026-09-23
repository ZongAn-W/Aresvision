import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from './api.js';

let requests;
test.beforeEach(() => {
  requests = [];
  globalThis.localStorage = { getItem: () => 'test-token', removeItem() {} };
  globalThis.window = { dispatchEvent() {} };
  globalThis.fetch = async (url, options) => {
    requests.push({ url, ...options, body: options.body ? JSON.parse(options.body) : undefined });
    return { ok: true, status: 200, json: async () => [] };
  };
});

test('tag endpoints send authenticated requests and preserve additive/removal intent', async () => {
  assert.equal(typeof api.fetchTrainingTags, 'function');
  await api.fetchTrainingTags();
  await api.createTrainingTag('Dust');
  await api.renameTrainingTag(3, 'Baseline');
  await api.replaceTrainingTaskTags(7, [3, 4]);
  await api.updateTrainingTaskTags([7, 8], [3], 'remove');
  await api.deleteTrainingTag(3);
  assert.deepEqual(requests.map(r => [r.url, r.method || 'GET', r.body]), [
    ['/api/training/tags', 'GET', undefined],
    ['/api/training/tags', 'POST', { name: 'Dust' }],
    ['/api/training/tags/3', 'PATCH', { name: 'Baseline' }],
    ['/api/training/tasks/7/tags', 'PUT', { tag_ids: [3, 4] }],
    ['/api/training/task-tags', 'PATCH', { task_ids: [7, 8], tag_ids: [3], operation: 'remove' }],
    ['/api/training/tags/3', 'DELETE', undefined],
  ]);
  assert.ok(requests.every(r => r.headers.Authorization === 'Bearer test-token'));
});

test('training start sends optional tags outside hyperparameters', async () => {
  await api.startTrainingTask('demo3.py', { horizon: 3 }, 'Model', 'default', { tagIds: [5] });
  assert.deepEqual(requests[0].body.tag_ids, [5]);
  assert.deepEqual(requests[0].body.hyperparameters, { horizon: 3 });
  await api.startTrainingTask('demo3.py', {}, 'Legacy');
  assert.deepEqual(requests[1].body.tag_ids, []);
});

test('tag errors include backend detail instead of reporting success', async () => {
  assert.equal(typeof api.createTrainingTag, 'function');
  globalThis.fetch = async () => ({ ok: false, status: 409, json: async () => ({ detail: 'Tag name already exists' }) });
  await assert.rejects(api.createTrainingTag('Dust'), /Tag name already exists/);
});
