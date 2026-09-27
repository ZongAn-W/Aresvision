import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_PREDICT_MODEL_MODE,
  PREDICT_MODEL_MODES,
  buildPredictHash,
  normalizePredictModelMode,
  readPredictModeFromHash,
} from './predictModelModes.js';

test('predict model source options hide the system model mode', () => {
  assert.deepEqual(PREDICT_MODEL_MODES, ['trained', 'trained_compare']);
  assert.equal(PREDICT_MODEL_MODES.includes('system'), false);
});

test('predict model mode falls back to trained when cache contains removed system mode', () => {
  assert.equal(DEFAULT_PREDICT_MODEL_MODE, 'trained');
  assert.equal(normalizePredictModelMode('system'), 'trained');
  assert.equal(normalizePredictModelMode(''), 'trained');
  assert.equal(normalizePredictModelMode(null), 'trained');
  assert.equal(normalizePredictModelMode('trained_compare'), 'trained_compare');
});

test('从 hash query 读取模型比较模式', () => {
  assert.equal(
    readPredictModeFromHash('#/predict?from=training&mode=trained_compare'),
    'trained_compare'
  );
  assert.equal(readPredictModeFromHash('#/predict?mode=trained'), 'trained');
  assert.equal(readPredictModeFromHash('#/predict?mode=trained_compare&from=training'), 'trained_compare');
});

test('非法模式不会覆盖默认模式', () => {
  assert.equal(readPredictModeFromHash('#/predict?mode=unknown'), null);
  assert.equal(readPredictModeFromHash('#/predict?mode='), null);
  assert.equal(readPredictModeFromHash('#/predict?from=training'), null);
  assert.equal(readPredictModeFromHash('#/predict'), null);
  assert.equal(readPredictModeFromHash(''), null);
  assert.equal(readPredictModeFromHash(null), null);
  assert.equal(normalizePredictModelMode(readPredictModeFromHash('#/predict?mode=unknown')), 'trained');
});

test('训练页可以构造带比较模式的预测页 hash', () => {
  assert.equal(buildPredictHash({ from: 'training' }), '#/predict?from=training');
  assert.equal(
    buildPredictHash({ from: 'training', mode: 'trained_compare' }),
    '#/predict?from=training&mode=trained_compare'
  );
  assert.equal(buildPredictHash({ mode: 'unknown' }), '#/predict');
  assert.equal(buildPredictHash({}), '#/predict');
});
