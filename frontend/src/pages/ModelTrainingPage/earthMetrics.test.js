import test from 'node:test';
import assert from 'node:assert/strict';
import { readExperimentMetrics, buildExperimentSummary } from './experimentCenterModel.js';
import { getMatrixValue, formatMatrixValue, getMatrixPropertyDefinitions } from './experimentMatrixModel.js';
import { EARTH_METRIC_META, earthMetricUnit } from '../../utils/earthMetricMeta.js';
import { readEarthMetric, readEarthLeadMetric, readEarthHorizonMetric } from '../PredictPage/earthPredictModel.js';
import { sortCompareItems, metricValue, buildStepCurveTraces } from '../PredictPage/CompareTrainingModels/compareTrainingModelsData.js';

const overall = { mse: 4, rmse: 2, mae: 1, r2: -3, mape: 5, smape: 4 };
const metrics = { schema: 'earth_training_metrics_3hourly_v2', unit: 'DU', target: 'TO3',
  splits: { test: { overall }, validation: { overall: { ...overall, rmse: 7 } } } };
const task = { id: 8, dataset_id: 'earth_merra2_3hourly_v1', metrics: JSON.stringify(metrics) };

test('Earth results and matrix default to full test set; validation is explicit', () => {
  assert.deepEqual(readExperimentMetrics(task.metrics), overall);
  assert.equal(readExperimentMetrics(task.metrics, 'validation').rmse, 7);
  assert.deepEqual(buildExperimentSummary(task).metrics, overall);
  assert.equal(getMatrixValue(task, 'metric:rmse'), 2);
  assert.match(getMatrixPropertyDefinitions([task]).find(c => c.key === 'metric:rmse').labelEn, /full test set/);
  assert.deepEqual(readExperimentMetrics({ ...metrics, splits: { validation: metrics.splits.validation }, rmse: 99 }), {});
});

test('old Earth metrics stay partial; invalid new values are missing without top-level fallback', () => {
  const legacy = { ...metrics, schema: 'earth_training_metrics_3hourly_v1',
    splits: { test: { overall: { rmse: 2, mae: 1, mse: null, r2: NaN, mape: '2', smape: Infinity } } }, mse: 99 };
  assert.deepEqual(readExperimentMetrics(legacy), { rmse: 2, mae: 1 });
  for (const key of ['mse', 'r2', 'mape', 'smape']) {
    assert.equal(getMatrixValue({ ...task, metrics: legacy }, `metric:${key}`), undefined);
    assert.equal(formatMatrixValue(undefined, { key: `metric:${key}` }, task), '未提供');
  }
});

test('Mars top-level aliases and numeric-string compatibility are preserved', () => {
  assert.deepEqual(readExperimentMetrics({ RMSE: .4, mae: '0.2', R2: -.9, MAPE: 3, SMAPE: 4 }),
    { rmse: .4, mae: '0.2', r2: -.9, mape: 3, smape: 4 });
});

test('Earth units and labels cover all six metrics in both languages', () => {
  const units = { mse: 'DU²', rmse: 'DU', mae: 'DU', r2: 'dimensionless', mape: '%', smape: '%' };
  for (const metric of EARTH_METRIC_META) {
    assert.equal(earthMetricUnit(metric.key), units[metric.key]);
    assert.ok(metric.zh && metric.en);
    const formatted = formatMatrixValue(overall[metric.key], { key: `metric:${metric.key}` }, task, 'en');
    assert.ok(formatted.endsWith(units[metric.key]));
  }
});

test('current forecast, per-lead and cumulative metrics retain finite negative R2 and zero errors', () => {
  const prediction = { overall, by_lead: [{ lead_step: 1, ...overall }], by_horizon: [{ horizon_hours: 3, ...overall }] };
  for (const { key } of EARTH_METRIC_META) {
    assert.equal(readEarthMetric(prediction, key), overall[key]);
    assert.equal(readEarthLeadMetric(prediction, 1, key), overall[key]);
    assert.equal(readEarthHorizonMetric(prediction, 3, key), overall[key]);
  }
  assert.equal(readEarthMetric({ overall: { rmse: 0 } }, 'rmse'), 0);
  assert.equal(readEarthMetric({ overall: { mse: null } }, 'mse'), null);
});

test('rank errors and percentages ascending, R2 descending, and exclude missing values', () => {
  for (const { key } of EARTH_METRIC_META) {
    const items = [3, 1, 2].map(id => ({ task_id: id, metrics: { overall: { [key]: key === 'r2' ? -id : id } } }));
    items.push(...[undefined, null, NaN, Infinity, ''].map((value, index) => ({ task_id: 10 + index, metrics: { overall: { [key]: value } } })));
    assert.deepEqual(sortCompareItems(items, { metric: key }).slice(0, 3).map(item => item.task_id), [1, 2, 3]);
    for (const item of items.slice(3)) assert.equal(metricValue(item, key), null);
  }
  assert.equal(metricValue({ metrics: { overall: { mse: 0 } } }, 'mse'), 0);
});

test('step curves omit absent old-model metrics and keep negative R2 values', () => {
  const items = [{ task_id: 1, metrics: { per_step: [{ step: 1, r2: -4 }, { step: 2, r2: -.5 }] } },
    { task_id: 2, metrics: { per_step: [{ step: 1, rmse: 4 }, { step: 2, r2: null }] } }];
  assert.deepEqual(buildStepCurveTraces(items, 'r2').map(trace => trace.y), [[-4, -.5]]);
});
