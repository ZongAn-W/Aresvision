import test from 'node:test';
import assert from 'node:assert/strict';
import zh from '../../i18n/zh.js';
import en from '../../i18n/en.js';

import {
  DEFAULT_PREDICT_MODEL_MODE,
  PREDICT_MODEL_MODES,
  buildPredictHash,
  normalizePredictModelMode,
  readPredictModeFromHash,
  predictModeSelection,
  composePredictMode,
} from './predictModelModes.js';

test('predict model source options hide the system model mode', () => {
  // 地球历史预测是与火星两种模式并列的独立模式；旧 system 模式仍然隐藏。
  assert.deepEqual(PREDICT_MODEL_MODES, ['trained', 'trained_compare', 'earth', 'earth_compare']);
  assert.equal(PREDICT_MODEL_MODES.includes('system'), false);
});

test('planet changes preserve the chosen analysis and legacy hashes resolve to the same selections', () => {
  assert.deepEqual(predictModeSelection('earth'), { planet: 'earth', analysis: 'single' });
  assert.deepEqual(predictModeSelection('trained_compare'), { planet: 'mars', analysis: 'compare' });
  for (const planet of ['earth', 'mars']) {
    for (const analysis of ['single', 'compare']) {
      const mode = composePredictMode(planet, analysis);
      assert.deepEqual(predictModeSelection(mode), { planet, analysis });
      assert.equal(readPredictModeFromHash(buildPredictHash({ from: 'training', mode })), mode);
    }
  }
});

test('both languages supply the planet controls and Earth prediction copy in the predict namespace', () => {
  for (const dictionary of [zh, en]) {
    for (const key of ['planetSelection', 'analysisSelection', 'earthCompareNote', 'earthOriginLabel', 'earthDatasetRetired']) {
      assert.equal(typeof dictionary.predict[key], 'string', key);
    }
    assert.equal(typeof dictionary.predict.planet.earth, 'string');
    assert.equal(typeof dictionary.predict.analysis.compare, 'string');
  }
});

test('从 hash query 读取地球历史预测模式', () => {
  assert.equal(readPredictModeFromHash('#/predict?from=training&mode=earth'), 'earth');
  assert.equal(readPredictModeFromHash('#/predict?mode=earth'), 'earth');
  assert.equal(normalizePredictModelMode('earth'), 'earth');
  assert.equal(buildPredictHash({ from: 'training', mode: 'earth' }), '#/predict?from=training&mode=earth');
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
