import test from 'node:test';
import assert from 'node:assert/strict';
import * as helpers from './trainingHyperparameterFormatting.js';
import zh from '../../i18n/zh.js';
import en from '../../i18n/en.js';

const translate = dict => key => key.split('.').reduce((value, part) => value?.[part], dict) ?? key;

test('history summary stays bounded while every visible custom parameter remains in details', () => {
  assert.equal(typeof helpers.buildTrainingHistoryParameters, 'function');
  const custom = { hidden_dim: 16, dropout: 0, use_gate: false, config: { blocks: [1, 2] } };
  const hypers = { model_source: 'uploaded', model_architecture: 'predrnnv2', epochs: 20, batch_size: 32, learning_rate: 0.001, window: 20, horizon: 20, seed: 11, _internal: 'hidden', custom_model_params: custom };
  const before = JSON.stringify(hypers);
  const result = helpers.buildTrainingHistoryParameters(hypers);
  assert.deepEqual(result.summary.map(([key]) => key), ['window', 'horizon', 'epochs', 'batch_size', 'learning_rate']);
  assert.deepEqual(result.groups.find(group => group.key === 'custom_model_params').entries, Object.entries(custom));
  assert.equal(result.groups.flatMap(group => group.entries).some(([key]) => key === 'model_architecture' || key === '_internal'), false);
  assert.equal(result.count, 10);
  assert.equal(JSON.stringify(hypers), before);
});

test('sparse records have no fabricated summary values and object values do not enter the summary', () => {
  assert.equal(typeof helpers.buildTrainingHistoryParameters, 'function');
  assert.deepEqual(helpers.buildTrainingHistoryParameters({}), { summary: [], groups: [], count: 0 });
  const result = helpers.buildTrainingHistoryParameters({ window: { invalid: true }, seed: 0 });
  assert.deepEqual(result.summary, []);
  assert.equal(result.groups.some(group => group.entries.some(([key, value]) => key === 'seed' && value === 0)), true);
});

test('parameter labels resolve in both languages and unknown keys never expose an i18n path', () => {
  assert.equal(typeof helpers.getTrainingParameterLabel, 'function');
  for (const dict of [zh, en]) {
    const t = translate(dict);
    for (const key of ['training_dataset', 'seed', 'custom_model_params', 'model_source']) {
      assert.notEqual(t(`modelTraining.hypers.${key}`), `modelTraining.hypers.${key}`);
      assert.equal(helpers.getTrainingParameterLabel(key, t), dict.modelTraining.hypers[key]);
    }
    assert.equal(helpers.getTrainingParameterLabel('new_custom_setting', t), 'new custom setting');
  }
});
