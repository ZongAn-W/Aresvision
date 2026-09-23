import test from 'node:test';
import assert from 'node:assert/strict';
import * as tagHelpers from './trainingTagFilters.js';
import { filterTaggedTasks, addVisibleSelection, createScopedRequestGate } from './trainingTagFilters.js';

const tasks = [
  { id: 1, custom_model_name: 'Dust baseline', tags: [{ id: 1 }, { id: 2 }] },
  { id: 2, custom_model_name: 'Dust test', tags: [{ id: 1 }] },
  { id: 3, custom_model_name: 'Control', tags: [] },
  { id: 4, custom_model_name: 'Legacy' },
];

test('name length counts Unicode characters after trimming without truncation', () => {
  assert.equal(typeof tagHelpers.isValidTagName, 'function');
  assert.equal(tagHelpers.isValidTagName('  ' + 'A'.repeat(64) + '  '), true);
  assert.equal(tagHelpers.isValidTagName('🚀'.repeat(64)), true);
  assert.equal(tagHelpers.isValidTagName('🚀'.repeat(65)), false);
  assert.equal(tagHelpers.isValidTagName(' \t '), false);
});

test('multiple tags require all matches and combine with name search', () => {
  assert.deepEqual(filterTaggedTasks(tasks, { tagIds: [1, 2], search: ' DUST ' }).map(t => t.id), [1]);
  assert.deepEqual(filterTaggedTasks(tasks, { tagIds: [1], search: 'baseline' }).map(t => t.id), [1]);
  assert.deepEqual(filterTaggedTasks(tasks, { tagIds: [1], search: 'control' }), []);
});

test('untagged includes historical tasks; duplicate input never repeats a model', () => {
  assert.deepEqual(filterTaggedTasks(tasks, { untagged: true }).map(t => t.id), [3, 4]);
  assert.deepEqual(filterTaggedTasks([...tasks, tasks[0]]).map(t => t.id), [1, 2, 3, 4]);
  assert.deepEqual(filterTaggedTasks(tasks, { tagIds: [999] }), []);
});

test('selecting visible results preserves models selected in other groups', () => {
  assert.deepEqual(addVisibleSelection([3, 1], [1, 2]), [3, 1, 2]);
  assert.deepEqual(addVisibleSelection([3], []), [3]);
});

test('newer requests and invalidation reject old polling responses', () => {
  const gate = createScopedRequestGate();
  gate.setScope('user:7');
  const old = gate.start();
  const fresh = gate.start();
  assert.equal(gate.isCurrent(old), false);
  assert.equal(gate.isCurrent(fresh), true);
  gate.invalidate();
  assert.equal(gate.isCurrent(fresh), false);
});

test('account switch including logout/login to the same account rejects pending work', () => {
  const gate = createScopedRequestGate();
  gate.setScope('user:7');
  const old = gate.start();
  gate.setScope(null);
  gate.setScope('user:7');
  assert.equal(gate.isCurrent(old), false);
  const own = gate.start();
  gate.setScope('user:8');
  assert.equal(gate.isCurrent(own), false);
  assert.equal(gate.isCurrent(gate.start()), true);
});
