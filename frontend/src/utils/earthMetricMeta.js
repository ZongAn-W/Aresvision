export const EARTH_METRIC_META = Object.freeze([
  { key: 'mse', name: 'MSE', zh: 'MSE 均方误差', en: 'MSE Mean squared error', unit: 'DU²', color: '#f0ad66' },
  { key: 'rmse', name: 'RMSE', zh: 'RMSE 均方根误差', en: 'RMSE Root mean squared error', unit: 'DU', color: '#e68383' },
  { key: 'mae', name: 'MAE', zh: 'MAE 平均绝对误差', en: 'MAE Mean absolute error', unit: 'DU', color: '#e6bc54' },
  { key: 'r2', name: 'R²', zh: 'R² 决定系数', en: 'R² Coefficient of determination', unit: '1', color: '#4acfac' },
  { key: 'mape', name: 'MAPE', zh: 'MAPE 平均绝对百分比误差', en: 'MAPE Mean absolute percentage error', unit: '%', color: '#79bbff' },
  { key: 'smape', name: 'SMAPE', zh: 'SMAPE 对称平均绝对百分比误差', en: 'SMAPE Symmetric mean absolute percentage error', unit: '%', color: '#d49bb7' },
]);

export function earthMetricUnit(key, isZh = false) {
  const unit = EARTH_METRIC_META.find(metric => metric.key === key)?.unit || '';
  return unit === '1' ? (isZh ? '无量纲' : 'dimensionless') : unit;
}

export function isEarthMetrics(metrics) {
  return String(metrics?.schema || '').startsWith('earth_training_metrics')
    || (metrics?.target === 'TO3' && metrics?.unit === 'DU');
}
