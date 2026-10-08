const AGGREGATION_LABELS = {
  mean_over_forecast_steps: {
    zh: '整体（各预测步平均）',
    en: 'Overall (mean across forecast steps)',
  },
  pooled_test_set_pixels: {
    zh: '整体（完整测试集汇总；RMSE/MAE/R² 按像素合并）',
    en: 'Overall (full test-set summary; RMSE/MAE/R² pool pixels)',
  },
};

function formatPercent(value) {
  const numeric = Number(value) * 100;
  if (!Number.isFinite(numeric)) return '--';
  return `${Number.isInteger(numeric) ? numeric : numeric.toFixed(1)}%`;
}

export function getMetricAggregationLabel(metrics, isZh = true) {
  if (metrics?.aggregation === 'forecast_origin_lead_grid_uniform') return isZh
    ? '完整测试集（起点 × 提前量 × 格点等权）' : 'Full test set (equal origin × lead × grid weights)';
  const label = AGGREGATION_LABELS[metrics?.aggregation?.overall];
  if (!label) return isZh ? '整体指标' : 'Overall metrics';
  return isZh ? label.zh : label.en;
}

export function getSplitLabel(metrics, isZh = true) {
  const splitMeta = metrics?.split_meta;
  if (splitMeta?.source === 'published_manifest_splits' && splitMeta.test_range) return isZh
    ? `发布测试分区：${splitMeta.test_range.date_start} — ${splitMeta.test_range.date_end} · ${splitMeta.window_count} 个窗口`
    : `Published test split: ${splitMeta.test_range.date_start} — ${splitMeta.test_range.date_end} · ${splitMeta.window_count} windows`;
  if (!splitMeta?.ratios) return '';

  if (splitMeta.legacy_compatibility) {
    return isZh
      ? '测试集划分：历史兼容 80%/20%（无验证集）'
      : 'Test split: legacy 80%/20% compatibility (no validation set)';
  }

  const ratios = splitMeta.ratios;
  const values = [ratios.train_ratio, ratios.validation_ratio, ratios.test_ratio].map(formatPercent);
  return isZh
    ? `测试集划分：训练/验证/测试 ${values.join('/')}`
    : `Test split: train/validation/test ${values.join('/')}`;
}
