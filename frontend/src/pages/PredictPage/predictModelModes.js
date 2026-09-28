export const PREDICT_MODEL_MODE_TRAINED = 'trained';
export const PREDICT_MODEL_MODE_COMPARE = 'trained_compare';
/** 地球历史预测：按日期起点回测，单位 DU，与火星 MY/Ls 模式完全分开。 */
export const PREDICT_MODEL_MODE_EARTH = 'earth';

export const PREDICT_MODEL_MODES = [
  PREDICT_MODEL_MODE_TRAINED,
  PREDICT_MODEL_MODE_COMPARE,
  PREDICT_MODEL_MODE_EARTH,
];

export const DEFAULT_PREDICT_MODEL_MODE = PREDICT_MODEL_MODE_TRAINED;

/** 训练页跳转预测页时显式请求比较模式的 query 参数名。 */
export const PREDICT_MODE_QUERY_PARAM = 'mode';

export function normalizePredictModelMode(value) {
  const mode = String(value || '').trim();
  return PREDICT_MODEL_MODES.includes(mode) ? mode : DEFAULT_PREDICT_MODEL_MODE;
}

/**
 * 从 hash 读取显式指定的预测模式（如 `#/predict?from=training&mode=trained_compare`）。
 *
 * 只接受已注册的模式；缺失或非法时返回 null，调用方继续使用默认模式或缓存模式。
 */
export function readPredictModeFromHash(hash) {
  const raw = String(hash || '');
  const queryStart = raw.indexOf('?');
  if (queryStart === -1) return null;
  const query = raw.slice(queryStart + 1).split('#')[0];
  if (!query) return null;

  for (const pair of query.split('&')) {
    if (!pair) continue;
    const separator = pair.indexOf('=');
    const key = decodeURIComponent(separator === -1 ? pair : pair.slice(0, separator)).trim();
    if (key !== PREDICT_MODE_QUERY_PARAM) continue;
    const value = decodeURIComponent(separator === -1 ? '' : pair.slice(separator + 1)).trim();
    return PREDICT_MODEL_MODES.includes(value) ? value : null;
  }
  return null;
}

/** 训练页导航到预测页时使用的 hash；query 参数保持不变。 */
export function buildPredictHash({ from = '', mode = null, base = '#/predict' } = {}) {
  const params = [];
  if (from) params.push(`from=${encodeURIComponent(from)}`);
  if (mode && PREDICT_MODEL_MODES.includes(mode)) params.push(`${PREDICT_MODE_QUERY_PARAM}=${encodeURIComponent(mode)}`);
  return params.length > 0 ? `${base}?${params.join('&')}` : base;
}
