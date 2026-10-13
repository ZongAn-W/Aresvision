import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildEarthTrainingHyperparameters, describeEarthTaskSplits, getEarthSplitDefaults,
  normalizeEarthSplitRatios, captureTrainingDraft, resolveEarthTrainingRestore,
  resolveMarsTrainingRestore } from './earthTrainingConfig.js';
import { readExperimentConfig } from './experimentCenterModel.js';
import { getMatrixPropertyDefinitions, getMatrixValue } from './experimentMatrixModel.js';
import { buildTrainingHistoryParameters } from './trainingHyperparameterFormatting.js';

const time = { start: '2020-01-01T01:30:00Z', end: '2021-12-31T22:30:00Z', count: 5848 };
const defaults = { trainRatio: .7, validationRatio: .2, testRatio: .1 };
const custom = { trainRatio: .6, validationRatio: .25, testRatio: .15 };

test('Earth defaults and custom preview allocate raw steps before windows', () => {
  assert.deepEqual(getEarthSplitDefaults({}), defaults);
  assert.deepEqual(getEarthSplitDefaults(custom), custom);
  assert.deepEqual(getEarthSplitDefaults({ trainRatio: .8, validationRatio: 0, testRatio: .2 }), defaults);
  const preview = describeEarthTaskSplits(time, defaults, 56, 24);
  assert.equal(preview.valid, true);
  assert.deepEqual(preview.ranges.map(item => item.step_count), [4094, 1169, 585]);
  assert.deepEqual(preview.ranges.map(item => item.window_count), [4015, 1090, 506]);
  assert.equal(preview.ranges[0].date_start, time.start);
  assert.equal(preview.ranges[2].date_end, time.end);
  const another = describeEarthTaskSplits(time, custom, 12, 8);
  assert.deepEqual(another.ranges.map(item => item.step_count), [3509, 1462, 877]);
  assert.equal(another.ranges[1].raw_start, another.ranges[0].raw_end);
  assert.equal(another.ranges[1].window_count, 1443);
});

test('invalid ratios and short partitions block Earth without changing Mars validation policy', () => {
  for (const value of [null, true, '', NaN, Infinity, {}, [], 0]) {
    assert.equal(normalizeEarthSplitRatios(.7, value, .1).valid, false);
  }
  assert.equal(normalizeEarthSplitRatios(.7, .25, .1).valid, false);
  assert.equal(normalizeEarthSplitRatios(.8, 0, .2).valid, false);
  assert.equal(normalizeEarthSplitRatios(.8, 0, .2, { allowEmptyValidation: true }).valid, true);
  const short = describeEarthTaskSplits({ start: time.start, end: '2020-01-30T22:30:00Z', count: 240 }, defaults, 56, 24);
  assert.equal(short.valid, false);
  assert.equal(short.error, 'short_partition');
  assert.throws(() => buildEarthTrainingHyperparameters({ trainRatio: .8, validationRatio: 0, testRatio: .2 }));
});

test('both model sources submit ratios as fractions and keep them through scene drafts', () => {
  for (const modelSource of ['official', 'uploaded']) {
    const payload = buildEarthTrainingHyperparameters({ ...custom, modelSource, windowValue: 12, horizon: 8 });
    assert.deepEqual([payload.train_ratio, payload.validation_ratio, payload.test_ratio], [.6, .25, .15]);
    assert.equal(payload.window, 12);
    assert.equal(Object.hasOwn(payload, '_earth_task_split'), false);
  }
  const earth = captureTrainingDraft({ ...custom, trainingDataset: 'earth_merra2_3hourly_v1', windowValue: 12, horizon: 8 });
  const mars = captureTrainingDraft({ trainRatio: .8, validationRatio: 0, testRatio: .2, trainingDataset: 'openmars_mcd' });
  assert.equal(resolveEarthTrainingRestore(earth).validationRatio, .25);
  assert.equal(resolveMarsTrainingRestore(mars).validationRatio, 0);
  assert.equal(resolveEarthTrainingRestore(earth).trainRatio, .6);
});

test('copy, parameter details and experiment matrix preserve requests and actual fixed boundaries', () => {
  const ranges = Object.fromEntries(describeEarthTaskSplits(time, custom, 12, 8).ranges.map(({ name, ...item }) => [name, item]));
  const hyperparameters = { ...buildEarthTrainingHyperparameters({ ...custom, windowValue: 12, horizon: 8 }),
    _earth_task_split: { policy: 'earth_raw_utc_timeline_v1', ranges } };
  const task = { id: 1, dataset_id: 'earth_merra2_3hourly_v1', hyperparameters };
  const copy = readExperimentConfig(task);
  assert.deepEqual([copy.trainRatio, copy.validationRatio, copy.testRatio], [.6, .25, .15]);
  assert.equal(copy.windowValue, 12);
  assert.equal(copy.horizon, 8);
  assert.equal(Object.hasOwn(copy, '_earth_task_split'), false);
  assert.equal(getMatrixValue(task, 'training:validation_ratio'), .25);
  assert.equal(getMatrixValue(task, 'split:test:date_start'), ranges.test.date_start);
  assert.equal(getMatrixValue(task, 'split:train:window_count'), 3490);
  assert.ok(getMatrixPropertyDefinitions([task]).some(item => item.key === 'split:test:window_count'));
  assert.ok(buildTrainingHistoryParameters(hyperparameters).groups.some(group => group.key === 'task_split'));
});

test('editable percentage fields convert to fractions and preview current configured windows', () => {
  const workspace = readFileSync(new URL('./ExperimentConfigWorkspace.jsx', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../ModelTrainingPage.jsx', import.meta.url), 'utf8');
  assert.match(workspace, /data-earth-task-split=/);
  assert.match(workspace, /Number\(event.target.value\) \/ 100/);
  assert.doesNotMatch(workspace, /data-earth-fixed-split/);
  const strategy = workspace.slice(workspace.indexOf("activeTab === 'strategy'"), workspace.indexOf("activeTab === 'transfer'"));
  assert.doesNotMatch(strategy, /disabled readOnly/);
  assert.match(workspace, /item.date_start[\s\S]*item.step_count[\s\S]*item.window_count/);
  assert.match(workspace, /describeEarthTaskSplits[\s\S]*windowValue, horizon/);
  assert.match(page, /buildEarthTrainingHyperparameters\({[\s\S]*trainRatio, validationRatio, testRatio/);
  assert.match(page, /!earthSplitPreview.valid/);
});
