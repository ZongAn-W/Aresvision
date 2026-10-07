import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildErrorDistributionKey,
  buildTrainingModelCompareKey,
  buildPermutationImportanceKey,
  buildPredictionContextKey,
  buildPredictMetricsKey,
  isPredictionCacheContextCurrent,
  normalizePredictionContext,
} from './predictAnalysisCacheKeys.js';

const TRAINED_CONTEXT = {
  modelMode: 'trained',
  trainingTaskId: 42,
  horizon: 3,
  selectedVars: ['Temperature', 'U_Wind'],
  lsStart: 90,
};

test('prediction context normalizes selected variables without dropping request parameters', () => {
  assert.deepEqual(normalizePredictionContext({
    ...TRAINED_CONTEXT,
    selectedVars: [' U_Wind ', 'Temperature', 'U_Wind', ''],
  }), {
    modelMode: 'trained',
    trainingTaskId: 42,
    horizon: 3,
    lsStart: 90,
    selectedVars: ['Temperature', 'U_Wind'],
    // 地球历史预测身份：火星上下文留空，键不变。
    forecastOrigin: '',
    datasetId: '',
    datasetFingerprint: '',
  });
});

test('Mars cache treats 0 and 360 degrees as the same Ls position', () => {
  assert.equal(
    buildPredictionContextKey({ ...TRAINED_CONTEXT, lsStart: 0 }),
    buildPredictionContextKey({ ...TRAINED_CONTEXT, lsStart: 360 }),
  );
});

test('地球历史预测上下文把预测起点与数据集身份并入键，火星键不受影响', () => {
  const earthContext = {
    modelMode: 'earth',
    trainingTaskId: 7,
    horizon: 3,
    selectedVars: [],
    forecastOrigin: '2021-07-08',
    datasetId: 'earth_merra2_daily_v2',
    datasetFingerprint: 'a'.repeat(64),
  };
  const earthKey = buildPredictionContextKey(earthContext);
  assert.match(earthKey, /mode:earth/);
  assert.match(earthKey, /origin:2021-07-08/);
  assert.match(earthKey, /ds:earth_merra2_daily_v2/);
  assert.match(earthKey, /fp:a{64}/);
  // 起点变化必须改变键，避免两个起点共用一条缓存。
  assert.notEqual(
    earthKey,
    buildPredictionContextKey({ ...earthContext, forecastOrigin: '2021-07-09' })
  );
  // 数据集发布变化同样改变键。
  assert.notEqual(
    earthKey,
    buildPredictionContextKey({ ...earthContext, datasetFingerprint: 'b'.repeat(64) })
  );
  // 火星键保持原有构成，不因新增字段而失效。
  assert.equal(
    buildPredictionContextKey(TRAINED_CONTEXT),
    'mode:trained|task:42|h:3|ls:90|vars:Temperature,U_Wind'
  );
});

test('prediction context key is stable for reordered variables', () => {
  assert.equal(
    buildPredictionContextKey(TRAINED_CONTEXT),
    buildPredictionContextKey({
      ...TRAINED_CONTEXT,
      selectedVars: ['U_Wind', 'Temperature', 'Temperature'],
    })
  );
});

test('Mars prediction context ignores legacy Mars-year values', () => {
  assert.equal(
    buildPredictionContextKey({ ...TRAINED_CONTEXT, marsYear: 27 }),
    buildPredictionContextKey({ ...TRAINED_CONTEXT, marsYear: 28 }),
  );
});

test('prediction context key changes with every critical single-model parameter', () => {
  const key = buildPredictionContextKey(TRAINED_CONTEXT);
  const changes = [
    { modelMode: 'system' },
    { trainingTaskId: 43 },
    { horizon: 2 },
    { lsStart: 91 },
    { selectedVars: ['Temperature'] },
  ];

  changes.forEach((change) => {
    assert.notEqual(key, buildPredictionContextKey({ ...TRAINED_CONTEXT, ...change }));
  });
});

test('prediction cache context only matches an exact current request context', () => {
  const key = buildPredictionContextKey(TRAINED_CONTEXT);

  assert.equal(isPredictionCacheContextCurrent(key, TRAINED_CONTEXT), true);
  assert.equal(isPredictionCacheContextCurrent(key, { ...TRAINED_CONTEXT, trainingTaskId: 43 }), false);
  assert.equal(isPredictionCacheContextCurrent(null, TRAINED_CONTEXT), false);
});

test('trained model analysis keys follow the complete request context', () => {
  const base = {
    ...TRAINED_CONTEXT,
  };

  assert.notEqual(
    buildPredictMetricsKey(base),
    buildPredictMetricsKey({ ...base, lsStart: 180 })
  );
  assert.notEqual(
    buildErrorDistributionKey(base),
    buildErrorDistributionKey({ ...base, selectedVars: ['U_Wind'] })
  );
});

test('trained model permutation importance key changes when selected variables change', () => {
  const base = {
    modelMode: 'trained',
    trainingTaskId: 42,
    horizon: 3,
    selectedVars: ['Temperature'],
  };

  assert.notEqual(
    buildPermutationImportanceKey(base),
    buildPermutationImportanceKey({ ...base, selectedVars: ['U_Wind'] })
  );
});

test('system distribution key normalizes variables and follows the complete context', () => {
  assert.equal(
    buildErrorDistributionKey({
      modelMode: 'system',
      dataSourceMode: 'default',
      selectedVars: ['V_Wind', 'Temperature'],
    }),
    buildErrorDistributionKey({
      modelMode: 'system',
      dataSourceMode: 'default',
      selectedVars: ['Temperature', 'V_Wind'],
    })
  );

  assert.notEqual(
    buildErrorDistributionKey({
      modelMode: 'system',
      dataSourceMode: 'default',
      selectedVars: ['Temperature'],
    }),
    buildErrorDistributionKey({
      modelMode: 'system',
      dataSourceMode: 'default',
      selectedVars: ['U_Wind'],
    })
  );

  assert.notEqual(
    buildErrorDistributionKey({
      modelMode: 'system',
      selectedVars: ['Temperature'],
      lsStart: 90,
      horizon: 3,
    }),
    buildErrorDistributionKey({
      modelMode: 'system',
      selectedVars: ['Temperature'],
      lsStart: 91,
      horizon: 3,
    })
  );
});

test('system prediction metrics key does not include personal data source mode', () => {
  const base = {
    modelMode: 'system',
    selectedVars: ['Temperature'],
    lsStart: 90,
    horizon: 3,
  };

  assert.equal(
    buildPredictMetricsKey({ ...base, dataSourceMode: 'default' }),
    buildPredictMetricsKey({ ...base, dataSourceMode: 'personal' })
  );
});

test('system distribution key no longer disables personal mode branches', () => {
  const base = {
    modelMode: 'system',
    selectedVars: ['Temperature'],
  };

  assert.equal(
    buildErrorDistributionKey({ ...base, dataSourceMode: 'default' }),
    buildErrorDistributionKey({ ...base, dataSourceMode: 'personal' })
  );
});

test('training model comparison key is stable for reordered task ids', () => {
  assert.equal(
    buildTrainingModelCompareKey({ taskIds: [18, 12, 23], horizon: 3, compareType: 'metrics' }),
    'compare:12,18,23:h:3:type:metrics'
  );
  assert.equal(
    buildTrainingModelCompareKey({ taskIds: [23, 18, 12], horizon: 3, compareType: 'metrics' }),
    'compare:12,18,23:h:3:type:metrics'
  );
});

test('training model comparison key requires at least two valid task ids', () => {
  assert.equal(buildTrainingModelCompareKey({ taskIds: [12], horizon: 3, compareType: 'metrics' }), null);
  assert.equal(buildTrainingModelCompareKey({ taskIds: [12, 'abc'], horizon: 3, compareType: 'metrics' }), null);
});
