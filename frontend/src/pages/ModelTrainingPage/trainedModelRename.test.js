import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeTrainedModelName,
  validateTrainedModelName,
} from './trainedModelRename.js';

const tasks = [
  { id: 1, custom_model_name: 'Alpha', status: 'completed' },
  { id: 2, custom_model_name: 'Beta', status: 'completed' },
];

test('normalizes trained model names before submission', () => {
  assert.equal(normalizeTrainedModelName('  Mars forecast  '), 'Mars forecast');
});

test('requires a non-empty trained model name', () => {
  assert.equal(validateTrainedModelName('   ', tasks, 1, 'zh'), '模型名称不能为空');
});

test('limits trained model names to 255 characters', () => {
  assert.equal(validateTrainedModelName('x'.repeat(256), tasks, 1, 'en'), 'Model name must be 255 characters or fewer');
});

test('rejects an unchanged trained model name', () => {
  assert.equal(validateTrainedModelName(' Alpha ', tasks, 1, 'en'), 'Enter a different model name');
});

test('rejects a duplicate name while excluding the active task', () => {
  assert.equal(validateTrainedModelName('Beta', tasks, 1, 'en'), "Model name 'Beta' is already in use");
  assert.equal(validateTrainedModelName('Gamma', tasks, 1, 'en'), '');
});
