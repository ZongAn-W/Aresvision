function normalizeVars(vars = []) {
  return [...new Set((Array.isArray(vars) ? vars : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean))]
    .sort();
}

function normalizePositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function normalizeFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeMarsLsStart(value) {
  const number = normalizeFiniteNumber(value);
  if (number === null) return null;
  const normalized = number % 360;
  return Object.is(normalized, -0) ? 0 : normalized;
}

export function normalizePredictionContext({
  modelMode,
  trainingTaskId,
  horizon,
  selectedVars,
  lsStart,
  forecastOrigin,
  datasetId,
  datasetFingerprint,
} = {}) {
  return {
    modelMode: String(modelMode || '').trim(),
    trainingTaskId: normalizePositiveNumber(trainingTaskId),
    horizon: normalizePositiveNumber(horizon),
    lsStart: normalizeMarsLsStart(lsStart),
    selectedVars: normalizeVars(selectedVars),
    // 地球历史预测按日期起点区分；火星模式不传这些字段，键保持原样。
    forecastOrigin: String(forecastOrigin || '').trim(),
    datasetId: String(datasetId || '').trim(),
    datasetFingerprint: String(datasetFingerprint || '').trim(),
  };
}

export function buildPredictionContextKey(context) {
  const normalized = normalizePredictionContext(context);
  const parts = [
    `mode:${normalized.modelMode}`,
    `task:${normalized.trainingTaskId ?? 'none'}`,
    `h:${normalized.horizon ?? 'none'}`,
    `ls:${normalized.lsStart ?? 'none'}`,
    `vars:${normalized.selectedVars.join(',')}`,
  ];
  // 只有地球上下文才追加日期与数据集身份：火星键不因新字段改变，避免旧缓存全部失效。
  if (normalized.forecastOrigin) {
    parts.push(`origin:${normalized.forecastOrigin}`);
    parts.push(`ds:${normalized.datasetId || 'none'}`);
    parts.push(`fp:${normalized.datasetFingerprint || 'none'}`);
  }
  return parts.join('|');
}

export function isPredictionCacheContextCurrent(cacheContextKey, context) {
  return Boolean(cacheContextKey) && cacheContextKey === buildPredictionContextKey(context);
}

function buildAnalysisKey(type, context) {
  const normalized = normalizePredictionContext(context);
  if (normalized.modelMode === 'trained' && !normalized.trainingTaskId) return null;
  return `${type}:${buildPredictionContextKey(normalized)}`;
}

export function buildPredictMetricsKey(context) {
  return buildAnalysisKey('metrics', context);
}

export function buildErrorDistributionKey(context) {
  return buildAnalysisKey('error-distribution', context);
}

export function buildPermutationImportanceKey(context) {
  return buildAnalysisKey('pfi', context);
}

export function buildTrainingModelCompareKey({ taskIds, horizon, compareType = 'metrics' }) {
  const ids = (Array.isArray(taskIds) ? taskIds : [])
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item > 0)
    .sort((a, b) => a - b);
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length < 2) return null;
  return `compare:${uniqueIds.join(',')}:h:${horizon}:type:${compareType}`;
}
