import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_TRAINING_DEFAULTS, normalizeTrainingDefaults } from '../../utils/trainingDefaults.js';

const pageSource = readFileSync(new URL('../ModelTrainingPage.jsx', import.meta.url), 'utf8');

test('training defaults include editable strategy settings with the supported baseline split', () => {
  assert.deepEqual(DEFAULT_TRAINING_DEFAULTS, {
    epochs: 10,
    batchSize: 32,
    learningRate: 0.001,
    window: 3,
    horizon: 3,
    trainRatio: 0.7,
    validationRatio: 0.2,
    testRatio: 0.1,
    earlyStoppingPatience: 0,
    seed: 11,
    transferEnabled: false,
    transferFreezeMode: 'none',
    finetuneLearningRate: 0.0001,
  });
});

test('normalizes valid saved training parameter and strategy defaults', () => {
  assert.deepEqual(normalizeTrainingDefaults({
    epochs: '24',
    batchSize: 8,
    learningRate: '0.0005',
    window: 6,
    horizon: 2,
    trainRatio: 0.6,
    validationRatio: 0.25,
    testRatio: 0.15,
    earlyStoppingPatience: 5,
    seed: 0,
    transferEnabled: true,
    transferFreezeMode: 'backbone',
    finetuneLearningRate: 0.00002,
  }), {
    epochs: 24,
    batchSize: 8,
    learningRate: 0.0005,
    window: 6,
    horizon: 2,
    trainRatio: 0.6,
    validationRatio: 0.25,
    testRatio: 0.15,
    earlyStoppingPatience: 5,
    seed: 0,
    transferEnabled: true,
    transferFreezeMode: 'backbone',
    finetuneLearningRate: 0.00002,
  });
});

test('falls back to supported parameter defaults when saved values exceed form/API bounds', () => {
  assert.deepEqual(normalizeTrainingDefaults({
    epochs: 1001,
    batchSize: 65,
    learningRate: 1.01,
    window: 31,
    horizon: 0,
    earlyStoppingPatience: 201,
    seed: 2147483648,
    finetuneLearningRate: 1.1,
  }), DEFAULT_TRAINING_DEFAULTS);

  assert.deepEqual(normalizeTrainingDefaults({
    epochs: 1000,
    batchSize: 64,
    learningRate: 1,
    window: 30,
    horizon: 30,
    earlyStoppingPatience: 200,
    seed: 2147483647,
    finetuneLearningRate: 1,
  }), {
    ...DEFAULT_TRAINING_DEFAULTS,
    epochs: 1000,
    batchSize: 64,
    learningRate: 1,
    window: 30,
    horizon: 30,
    earlyStoppingPatience: 200,
    seed: 2147483647,
    finetuneLearningRate: 1,
  });
});

test('falls back to the complete baseline split when saved ratios do not sum to one', () => {
  const normalized = normalizeTrainingDefaults({
    trainRatio: 0.6,
    validationRatio: 0.2,
    testRatio: 0.3,
    transferEnabled: true,
  });

  assert.equal(normalized.trainRatio, 0.7);
  assert.equal(normalized.validationRatio, 0.2);
  assert.equal(normalized.testRatio, 0.1);
  assert.equal(normalized.transferEnabled, true);
});

test('new experiments apply current defaults while copied configurations keep task values', () => {
  const createStart = pageSource.indexOf('const handleCreateExperiment = () => {');
  const createEnd = pageSource.indexOf('const handleSelectTask =', createStart);
  const createHandler = pageSource.slice(createStart, createEnd);
  assert.match(createHandler, /normalizeTrainingDefaults\(settings\.trainingDefaults\)/);
  [
    'setEpochs(defaults.epochs)',
    'setBatchSize(defaults.batchSize)',
    'setLearningRate(defaults.learningRate)',
    'setTrainRatio(defaults.trainRatio)',
    'setValidationRatio(defaults.validationRatio)',
    'setTestRatio(defaults.testRatio)',
    'setEarlyStoppingPatience(defaults.earlyStoppingPatience)',
    'setSeed(defaults.seed)',
    'setTransferEnabled(earthMode ? false : defaults.transferEnabled)',
    'setTransferFreezeMode(defaults.transferFreezeMode)',
    'setFinetuneLearningRate(defaults.finetuneLearningRate)',
    'setWindow(earthMode ? EARTH_WINDOW : defaults.window)',
    'setHorizon(earthMode ? EARTH_HORIZON : defaults.horizon)',
  ].forEach((statement) => assert.ok(createHandler.includes(statement), `missing ${statement}`));

  const copyStart = pageSource.indexOf('const handleCopyConfig = (task) => {');
  const copyEnd = pageSource.indexOf('const presetStatusText =', copyStart);
  const copyHandler = pageSource.slice(copyStart, copyEnd);
  assert.doesNotMatch(copyHandler, /normalizeTrainingDefaults/);
  ['setEpochs(config.epochs)', 'setBatchSize(config.batchSize)', 'setLearningRate(config.learningRate)']
    .forEach((statement) => assert.ok(copyHandler.includes(statement), `missing ${statement}`));
});

test('training validates split totals before either Earth or Mars submits a task', () => {
  const start = pageSource.indexOf('const handleStartTraining = async () => {');
  const end = pageSource.indexOf('const handleStopTask =', start);
  const handler = pageSource.slice(start, end);
  const splitValidationIndex = handler.indexOf('if (!splitRatios.valid)');
  const earthPathIndex = handler.indexOf('if (earthMode) {');
  const marsSubmitIndex = handler.indexOf('buildTrainingHyperparameters({');
  assert.ok(splitValidationIndex >= 0);
  assert.ok(earthPathIndex > splitValidationIndex);
  assert.ok(marsSubmitIndex > splitValidationIndex);
});
