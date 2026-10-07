import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getMetricAggregationLabel,
  getSplitLabel,
} from './predictionMetricMeta.js';

test('labels single prediction metrics as a forecast-step mean', () => {
  assert.equal(
    getMetricAggregationLabel({ aggregation: { overall: 'mean_over_forecast_steps' } }),
    '整体（各预测步平均）',
  );
});

test('labels test-set metrics as pooled pixels and exposes persisted split ratios', () => {
  const metrics = {
    aggregation: { overall: 'pooled_test_set_pixels' },
    split_meta: {
      ratios: { train_ratio: 0.7, validation_ratio: 0.2, test_ratio: 0.1 },
      source: 'task_metadata',
      legacy_compatibility: false,
    },
  };

  assert.equal(
    getMetricAggregationLabel(metrics),
    '整体（完整测试集汇总；RMSE/MAE/R² 按像素合并）',
  );
  assert.equal(getSplitLabel(metrics), '测试集划分：训练/验证/测试 70%/20%/10%');
});

test('marks old tasks with the explicit legacy split rule', () => {
  assert.equal(
    getSplitLabel({
      split_meta: {
        ratios: { train_ratio: 0.8, validation_ratio: 0, test_ratio: 0.2 },
        source: 'legacy_compatibility',
        legacy_compatibility: true,
      },
    }),
    '测试集划分：历史兼容 80%/20%（无验证集）',
  );
});
