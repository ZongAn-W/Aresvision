/**
 * Earth 年度分析的纯视图模型。
 *
 * 只做形状转换与文案，不发请求、不读 React context、不做单位换算：
 * 数值一律保持后端返回的原始物理单位。
 */

import { EARTH_VARIABLES, EARTH_VARIABLE_UNITS, EARTH_VARIABLE_LABEL_KEYS } from './earthOverviewModel.js';

export const EARTH_VARIABLE_COLORS = {
  TO3: '#ff8f68',
  U10M: '#6aa9ff',
  V10M: '#7bd3f7',
  T2M: '#4acfac',
  SWGDN: '#d9a441',
};

export const EARTH_POLAR_SCOPE_MIN_ABS_LATITUDE = 60;

export function variableLabel(variableId, isZh) {
  const key = EARTH_VARIABLE_LABEL_KEYS[variableId];
  if (!key) return variableId;
  const tail = key.split('.').pop();
  if (variableId === 'TO3') return isZh ? '臭氧柱总量' : 'Total column ozone';
  if (variableId === 'U10M') return isZh ? '10 m 纬向风' : '10 m eastward wind';
  if (variableId === 'V10M') return isZh ? '10 m 经向风' : '10 m northward wind';
  if (variableId === 'T2M') return isZh ? '2 m 气温' : '2 m air temperature';
  if (variableId === 'SWGDN') return isZh ? '地表入射短波' : 'Surface incoming shortwave';
  return tail;
}

export function formatValue(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : '--';
}

export function bandLabel(bandId, isZh) {
  const labels = {
    global: { zh: '全球', en: 'Global' },
    south_polar: { zh: '南极区', en: 'South polar' },
    south_mid: { zh: '南半球中纬', en: 'Southern mid-latitudes' },
    tropics: { zh: '热带', en: 'Tropics' },
    north_mid: { zh: '北半球中纬', en: 'Northern mid-latitudes' },
    north_polar: { zh: '北极区', en: 'North polar' },
  };
  const copy = labels[bandId];
  if (!copy) return bandId;
  return isZh ? copy.zh : copy.en;
}

/** 季节结构：纬度 × 日期的热力图；z[i][t] 与日期轴一一对应。 */
export function buildSeasonalHeatmap(suite, variableId, { isZh = true } = {}) {
  const entry = suite?.seasonal?.[variableId];
  if (!entry || !Array.isArray(entry.z) || !Array.isArray(suite?.dates)) return null;
  return {
    x: suite.dates,
    y: suite.latitude,
    z: entry.z,
    units: entry.units || EARTH_VARIABLE_UNITS[variableId] || '',
    xTitle: isZh ? '日期（UTC 日平均）' : 'Date (UTC daily mean)',
    yTitle: isZh ? '纬度' : 'Latitude',
    aggregation: entry.aggregation || 'equal_longitude_mean',
    xKind: 'date',
  };
}

/** 年内变化：五变量全球单元面积加权均值；可切换原始值与 Z-score。 */
export function buildRegionalTrend(suite, { isZh = true, normalized = false } = {}) {
  if (!suite?.regional_series || !Array.isArray(suite.dates)) return null;
  const series = EARTH_VARIABLES
    .filter((variableId) => Array.isArray(suite.regional_series[variableId]))
    .map((variableId) => ({
      id: variableId,
      label: variableLabel(variableId, isZh),
      units: normalized ? '' : (suite.variables?.find?.((item) => item.id === variableId)?.units
        || EARTH_VARIABLE_UNITS[variableId]
        || ''),
      color: EARTH_VARIABLE_COLORS[variableId],
      values: normalized
        ? (suite.zscore?.[variableId]?.values || suite.dates.map(() => null))
        : suite.regional_series[variableId],
      reason: normalized && !suite.zscore?.[variableId]?.values
        ? 'standardization_unavailable'
        : (suite.zscore?.[variableId]?.reason ?? null),
    }));
  if (!series.length) return null;
  return {
    x: suite.dates,
    xKind: 'date',
    xTitle: isZh ? '日期（UTC 日平均）' : 'Date (UTC daily mean)',
    yTitle: normalized ? 'Z-score' : (isZh ? '原始物理量' : 'Physical value'),
    series,
    aggregation: suite.aggregation?.regional || 'spherical_cell_area_mean',
  };
}

/** 季节极值：按纬带给出峰/谷日期与峰谷差。 */
export function buildExtremesTable(suite, variableId) {
  const extremes = suite?.extremes;
  const bands = suite?.bands;
  if (!extremes || !Array.isArray(bands)) return null;
  const rows = bands.map((band) => {
    const entry = extremes[band.id]?.[variableId];
    return {
      bandId: band.id,
      minLatitude: band.min_latitude,
      maxLatitude: band.max_latitude,
      gridPointCount: band.grid_point_count,
      units: entry?.units || EARTH_VARIABLE_UNITS[variableId] || '',
      max: entry?.max_value ?? null,
      maxDate: entry?.max_date ?? null,
      min: entry?.min_value ?? null,
      minDate: entry?.min_date ?? null,
      peakToPeak: entry?.peak_to_peak ?? null,
    };
  });
  return rows.length ? rows : null;
}

/** 环境因子：各纬带内环境变量与 TO3 的同期日均曲线。 */
export function buildEnvironmentSeries(suite, { bandId = 'global', isZh = true } = {}) {
  const variables = ['TO3', 'U10M', 'V10M', 'T2M', 'SWGDN'];
  const source = bandId === 'global' ? suite?.regional_series : suite?.band_series?.[bandId];
  if (!source || !Array.isArray(suite?.dates)) return null;
  const series = variables
    .filter((variableId) => Array.isArray(source[variableId]))
    .map((variableId) => ({
      id: variableId,
      label: variableLabel(variableId, isZh),
      units: EARTH_VARIABLE_UNITS[variableId] || '',
      color: EARTH_VARIABLE_COLORS[variableId],
      values: source[variableId],
    }));
  if (series.length < 2) return null;
  return {
    x: suite.dates,
    xKind: 'date',
    xTitle: isZh ? '日期（UTC 日平均）' : 'Date (UTC daily mean)',
    yTitle: isZh ? '原始物理量' : 'Physical value',
    series,
    bandId,
  };
}

export function relationshipScopeIds(suite) {
  const ids = ['global'];
  for (const band of suite?.bands || []) ids.push(band.id);
  return ids;
}

export function buildCorrelationMatrix(suite, scopeId = 'global') {
  const entry = suite?.relationships?.[scopeId]?.correlation;
  if (!entry) return null;
  return {
    scopeId,
    labels: entry.variable_order || EARTH_VARIABLES,
    r: entry.r,
    n: entry.n,
    reason: entry.reason,
  };
}

export function buildRelationship(suite, scopeId, kind) {
  const entry = suite?.relationships?.[scopeId]?.[kind];
  if (!entry) return null;
  const source = kind === 'solar_ozone' ? 'SWGDN' : 'T2M';
  const region = scopeId === 'global'
    ? (suite?.regional_series || {})
    : (suite?.band_series?.[scopeId] || {});
  const x = Array.isArray(region[source]) ? region[source] : [];
  const y = Array.isArray(region.TO3) ? region.TO3 : [];
  const dates = suite?.dates || [];
  // 颜色用“第几天”的数值索引，而不是 ISO 日期字符串：把日期字符串交给 Plotly
  // 作为 marker.color 会让色标量到 NaN 尺寸。日期仍出现在 tooltip 与色标刻度上。
  const colorValues = x.map((_, index) => index);
  const tickStep = Math.max(1, Math.ceil(dates.length / 6));
  const colorTicks = dates
    .map((date, index) => ({ date, index }))
    .filter(({ index }) => index % tickStep === 0);
  return {
    scopeId,
    kind,
    driverVariable: source,
    referenceVariable: 'TO3',
    driverUnits: EARTH_VARIABLE_UNITS[source] || '',
    referenceUnits: EARTH_VARIABLE_UNITS.TO3 || '',
    x,
    y,
    dates,
    colorValues,
    colorTicks,
    r: entry.r,
    n: entry.n,
    reason: entry.reason,
    regression: entry.regression || null,
    regressionUnits: kind === 'solar_ozone' ? 'DU / (W m-2)' : 'DU / K',
    lag: Array.isArray(entry.lag) ? entry.lag : [],
  };
}

/** 空间距平：年平均场减去同纬度经度均值；参考线固定为 0。 */
export function buildSpatialAnomaly(spatial) {
  if (!spatial || !Array.isArray(spatial.anomaly)) return null;
  return {
    x: spatial.lon,
    y: spatial.lat,
    z: spatial.anomaly,
    units: spatial.units,
    reference: spatial.reference || 'annual_mean_minus_equal_longitude_mean',
    colorRange: spatial.color_range || null,
  };
}

export function buildBandDiagnostics(spatial) {
  if (!Array.isArray(spatial?.bands)) return null;
  const rows = spatial.bands.map((band) => ({
    bandId: band.id,
    rms: band.rms,
    peakToPeak: band.peak_to_peak,
    gridPointCount: band.grid_point_count,
    units: spatial.units,
  }));
  return rows.length ? rows : null;
}

/** 极区统计：显式返回实际采样纬度范围，阈值不当作真实网格点。 */
export function buildPolarSummary(polar) {
  if (!Array.isArray(polar?.bands)) return null;
  return {
    minAbsLatitude: polar.polar_scope?.min_abs_latitude ?? EARTH_POLAR_SCOPE_MIN_ABS_LATITUDE,
    sampling: polar.polar_scope?.sampling || 'daily_mean',
    note: polar.polar_scope?.note || 'diurnal_variation_not_resolvable',
    dates: polar.dates || [],
    bands: polar.bands,
    contrast: polar.hemisphere_contrast || null,
  };
}

/**
 * AI 解读请求体：只包含统计摘要、星球、变量、时间范围与区域，不含原始场数组。
 *
 * 字段名与后端 `EarthInsightRequest` 严格一致（该模型 `extra="forbid"`），
 * 因此这里不发送 scope_label / state / reason 等仅供界面使用的字段；
 * 服务端会按同一身份重新计算摘要，客户端数字只作补充说明。
 */
export function buildEarthInsightSnapshot({
  datasetId,
  fingerprint,
  year,
  date,
  variable,
  units,
  scope = 'global',
  cards = [],
  locale = 'zh',
  question = null,
}) {
  const MAX_LIST = 400;
  const trim = (values) => (Array.isArray(values) && values.length > MAX_LIST
    ? values.slice(0, MAX_LIST)
    : values);
  return {
    planet: 'earth',
    dataset_id: datasetId,
    expected_fingerprint: fingerprint,
    year,
    variable,
    date,
    scope,
    locale,
    question,
    summary: {
      units,
      cards: cards.map((card) => ({
        card: card.key,
        notes: Array.isArray(card.notes) ? trim(card.notes) : [],
        values: card.values && typeof card.values === 'object' ? card.values : {},
      })),
    },
  };
}

/** 卡片数值摘要：只取标量与短序列，绝不发送 [36][72] 原始场。 */
export function summarizeExtremesForInsight(rows) {
  if (!Array.isArray(rows)) return null;
  return {
    bands: rows.map((row) => ({
      band: row.bandId,
      min_latitude: row.minLatitude,
      max_latitude: row.maxLatitude,
      grid_points: row.gridPointCount,
      max: row.max,
      max_date: row.maxDate,
      min: row.min,
      min_date: row.minDate,
      peak_to_peak: row.peakToPeak,
    })),
  };
}

export function summarizeRelationshipForInsight(relationship) {
  if (!relationship) return null;
  return {
    scope: relationship.scopeId,
    driver: relationship.driverVariable,
    r: relationship.r,
    n: relationship.n,
    reason: relationship.reason,
    slope: relationship.regression?.slope ?? null,
    intercept: relationship.regression?.intercept ?? null,
    slope_units: relationship.regressionUnits,
    peak_lag_days: peakLagDays(relationship.lag),
  };
}

/** 最大 |r| 对应的滞后天数；仅作描述，UI 不得据此声称物理响应时间。 */
export function peakLagDays(lagRows) {
  if (!Array.isArray(lagRows) || !lagRows.length) return null;
  let best = null;
  for (const row of lagRows) {
    if (!Number.isFinite(row?.r)) continue;
    if (best === null || Math.abs(row.r) > Math.abs(best.r)) best = row;
  }
  return best ? best.lag_days : null;
}

export function summarizeCorrelationForInsight(matrix) {
  if (!matrix || !Array.isArray(matrix.r)) return null;
  const labels = matrix.labels || [];
  const pairs = [];
  for (let i = 0; i < matrix.r.length; i += 1) {
    for (let j = i + 1; j < (matrix.r[i]?.length || 0); j += 1) {
      const r = matrix.r[i][j];
      if (Number.isFinite(r)) {
        pairs.push({ pair: `${labels[i]}-${labels[j]}`, r, n: matrix.n?.[i]?.[j] ?? null });
      }
    }
  }
  pairs.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
  return { scope: matrix.scopeId, strongest: pairs.slice(0, 3), all: pairs };
}

/**
 * 极区摘要。后端 `_summary_limits` 从 summary 起算限制嵌套深度不超过 6 层，
 * 因此每个变量在这里压成以变量 id 为键的一行文本，不再多嵌一层对象或列表。
 */
export function summarizePolarForInsight(polar) {
  if (!polar) return null;
  const compactVariable = (variableId, entry) => {
    if (!entry) return `${variableId}: n/a`;
    return [
      `${variableId} ${entry.units ?? ''}`.trim(),
      `mean=${entry.mean ?? 'n/a'}`,
      `min=${entry.min_value ?? 'n/a'}`,
      `max=${entry.max_value ?? 'n/a'}`,
      `peak_to_peak=${entry.peak_to_peak ?? 'n/a'}`,
    ].join(' ');
  };
  return {
    min_abs_latitude: polar.minAbsLatitude,
    sampling: polar.sampling,
    note: polar.note,
    bands: (polar.bands || []).map((band) => ({
      band: band.id,
      grid_points: band.grid_point_count,
      latitude_values: Array.isArray(band.latitude_values) ? band.latitude_values.join(',') : '',
      ...Object.fromEntries(
        Object.entries(band.variables || {}).map(([variableId, entry]) => [
          variableId,
          compactVariable(variableId, entry),
        ]),
      ),
    })),
  };
}

export function summarizeSpatialForInsight(spatial) {
  if (!spatial) return null;
  return {
    variable: spatial.variable,
    units: spatial.units,
    reference: spatial.reference,
    color_range: spatial.color_range,
    bands: spatial.bands,
  };
}
