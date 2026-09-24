/**
 * 共用分析工作台的适配器契约、统一卡片状态与纯几何/时间辅助函数。
 *
 * 本模块不导入 React、不发起请求、不读取任何星球数据，只描述约定，因此
 * Mars 与 Earth 的 adapter 可以一起被单元测试。数值语义完全由 adapter 声明：
 * Earth 使用 ISO 日期与原始物理单位，Mars 保留 MY/Ls。
 */

export const PLANETS = ['earth', 'mars'];

/** 统一卡片状态。任何卡片都必须落在五种状态之一。 */
export const CARD_STATUS = Object.freeze({
  IDLE: 'idle',
  LOADING: 'loading',
  READY: 'ready',
  UNSUPPORTED: 'unsupported',
  ERROR: 'error',
});

export const CARD_STATUS_VALUES = Object.freeze(Object.values(CARD_STATUS));

/** 能力位：决定哪些卡片有数据依据，而不是“接口存在”。 */
export const CAPABILITY_KEYS = Object.freeze([
  'field',
  'playback',
  'pointProbe',
  'polar',
  'diurnal',
  'researchSuite',
  'spatialDiagnostics',
  'aiInsight',
]);

/** 三种分析模式的固定顺序，Mars 与 Earth 共用。 */
export const MODE_IDS = Object.freeze(['temporal', 'drivers', 'dynamics']);

/**
 * 稳定的能力原因码。前端只翻译原因码，不翻译服务端句子，
 * 这样“日平均数据没有日内采样”这类说明不会被误译成“暂无数据”。
 */
export const CAPABILITY_REASONS = Object.freeze({
  DIURNAL_DAILY_MEAN: 'daily_data_has_no_diurnal_samples',
  SPATIAL_ORBIT_ONLY: 'spatial_sampling_does_not_resolve_this',
  NOT_IMPLEMENTED: 'capability_not_implemented',
});

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

// ── 卡片状态 ────────────────────────────────────────────────────────────

export function createCardState(status, extra = {}) {
  if (!CARD_STATUS_VALUES.includes(status)) {
    throw new Error(`Unknown card status: ${status}`);
  }
  return {
    status,
    reason: extra.reason ?? null,
    message: extra.message ?? null,
    data: extra.data ?? null,
    errorCode: extra.errorCode ?? null,
    updatedAt: extra.updatedAt ?? null,
  };
}

export function cardIdle() {
  return createCardState(CARD_STATUS.IDLE);
}

export function cardLoading(previous = null) {
  // Keep the last good payload out of the loading state so a stale chart can
  // never be rendered under a new title.
  return createCardState(CARD_STATUS.LOADING, { updatedAt: previous?.updatedAt ?? null });
}

export function cardReady(data, updatedAt = null) {
  return createCardState(CARD_STATUS.READY, { data, updatedAt });
}

export function cardUnsupported(reason, message = null) {
  if (!reason) throw new Error('An unsupported card needs a stable reason code');
  return createCardState(CARD_STATUS.UNSUPPORTED, { reason, message });
}

export function cardError(code, message = null) {
  return createCardState(CARD_STATUS.ERROR, {
    errorCode: code || 'invalid_request',
    message,
  });
}

/** 只有 ready 状态允许渲染数值；其余状态必须渲染说明。 */
export function isCardRenderable(state) {
  return state?.status === CARD_STATUS.READY;
}

export function cardNeedsRequest(state) {
  return state?.status === CARD_STATUS.IDLE || state?.status === CARD_STATUS.LOADING;
}

// ── 几何 ────────────────────────────────────────────────────────────────

/**
 * 几何身份：相同维度但坐标不同必须视为不同几何，否则球面会画错位置。
 */
export function geometryKey(geometry) {
  if (!geometry) return 'none';
  const lat = Array.isArray(geometry.latCenters) ? geometry.latCenters : [];
  const lon = Array.isArray(geometry.lonCenters) ? geometry.lonCenters : [];
  const latBounds = Array.isArray(geometry.latBounds) ? geometry.latBounds : [];
  const lonBounds = Array.isArray(geometry.lonBounds) ? geometry.lonBounds : [];
  const round = (value) => (isFiniteNumber(value) ? value.toFixed(4) : 'x');
  return [
    geometry.planet || 'unknown',
    lat.length,
    lon.length,
    lat.length ? round(lat[0]) : 'x',
    lat.length ? round(lat[lat.length - 1]) : 'x',
    lon.length ? round(lon[0]) : 'x',
    lon.length ? round(lon[lon.length - 1]) : 'x',
    latBounds.map(round).join(','),
    lonBounds.map(round).join(','),
    geometry.wrapLongitude ? 'wrap' : 'nowrap',
  ].join('|');
}

export function isGeometryUsable(geometry) {
  if (!isPlainObject(geometry)) return false;
  const lat = geometry.latCenters;
  const lon = geometry.lonCenters;
  if (!Array.isArray(lat) || lat.length < 2 || !lat.every(isFiniteNumber)) return false;
  if (!Array.isArray(lon) || lon.length < 2 || !lon.every(isFiniteNumber)) return false;
  if (!Array.isArray(geometry.latBounds) || geometry.latBounds.length !== 2) return false;
  if (!Array.isArray(geometry.lonBounds) || geometry.lonBounds.length !== 2) return false;
  return true;
}

/** 覆盖范围判断；越界不夹取、不经度环绕。 */
export function pointInsideGeometry(geometry, lat, lon) {
  if (!isGeometryUsable(geometry)) return false;
  if (!isFiniteNumber(lat) || !isFiniteNumber(lon)) return false;
  const [south, north] = geometry.latBounds;
  const [west, east] = geometry.lonBounds;
  return lat >= south && lat <= north && lon >= west && lon <= east;
}

/**
 * 最近网格中心；同距离取较小下标。返回 null 表示覆盖范围外，绝不夹到边缘。
 */
export function nearestGeometryCell(geometry, lat, lon) {
  if (!pointInsideGeometry(geometry, lat, lon)) return null;
  const pick = (axis, value) => {
    let best = 0;
    let bestDistance = Math.abs(axis[0] - value);
    for (let index = 1; index < axis.length; index += 1) {
      const distance = Math.abs(axis[index] - value);
      if (distance < bestDistance) {
        best = index;
        bestDistance = distance;
      }
    }
    return best;
  };
  const row = pick(geometry.latCenters, lat);
  const col = pick(geometry.lonCenters, lon);
  return {
    row,
    col,
    lat: geometry.latCenters[row],
    lon: geometry.lonCenters[col],
  };
}

// ── 时间模型 ────────────────────────────────────────────────────────────

export function isIsoTimeModel(time) {
  return time?.kind === 'iso-date';
}

export function isMarsTimeModel(time) {
  return time?.kind === 'mars-year-ls';
}

export function isValidIsoDate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp)
    && new Date(timestamp).toISOString().slice(0, 10) === value;
}

/** 时间轴取值列表：Mars 为 Ls 采样，Earth 为 ISO 日期。 */
export function timeValues(time) {
  if (!Array.isArray(time?.values)) return [];
  return time.values.filter((value) => (isIsoTimeModel(time) ? isValidIsoDate(value) : isFiniteNumber(value)));
}

/** 时间轴取值 → 稳定 key；用于判断“当前帧是否已经展示”。 */
export function timeValueKey(time, value) {
  if (isIsoTimeModel(time)) return isValidIsoDate(value) ? value : null;
  return isFiniteNumber(value) ? value : null;
}

export function formatTimeValue(time, value, { isZh = true } = {}) {
  if (isIsoTimeModel(time)) return isValidIsoDate(value) ? value : '--';
  if (!isFiniteNumber(value)) return '--';
  return `${isZh ? 'Ls' : 'Ls'} ${value.toFixed(1)}\u00B0`;
}

/**
 * 播放下一帧。只有当前请求的帧确实已经展示成功时才前进，
 * 因此加载中的日期不会被跳过；到达末帧即停止，不循环。
 */
export function nextPlaybackValue({ time, values, displayedValue, requestedValue, playing, ready }) {
  if (!playing || !ready) return null;
  const axis = Array.isArray(values) ? values : timeValues(time);
  if (!axis.length) return null;
  if (timeValueKey(time, displayedValue) === null || displayedValue !== requestedValue) return null;
  const index = axis.indexOf(displayedValue);
  if (index < 0 || index >= axis.length - 1) return null;
  return axis[index + 1];
}

export function playbackFinished({ values, displayedValue }) {
  const axis = Array.isArray(values) ? values : [];
  if (!axis.length) return false;
  return axis.indexOf(displayedValue) === axis.length - 1;
}

// ── 变量 ────────────────────────────────────────────────────────────────

export function findVariable(adapter, id) {
  const list = Array.isArray(adapter?.variables) ? adapter.variables : [];
  return list.find((item) => item.id === id) || null;
}

export function variableUnits(adapter, id) {
  return findVariable(adapter, id)?.unit ?? null;
}

/** 变量身份：切换变量必须清空旧数值，避免温度配上 DU。 */
export function variableIdentity(adapter, id) {
  const variable = findVariable(adapter, id);
  return variable ? `${adapter.sourceId}|${variable.id}|${variable.unit}` : null;
}

// ── 卡片目录 ────────────────────────────────────────────────────────────

/**
 * 返回某模式下按顺序排列的卡片定义。
 * 卡片定义形如
 * `{ key, title:{zh,en}, color, status, reason, message, capability }`。
 */
export function resolveModeCards(adapter, modeId) {
  const catalog = adapter?.cards;
  if (!isPlainObject(catalog)) return [];
  const rows = catalog[modeId];
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row) => isPlainObject(row) && typeof row.key === 'string' && row.key)
    .map((row) => ({
      key: row.key,
      title: row.title || { zh: row.key, en: row.key },
      desc: row.desc || null,
      color: row.color || null,
      capability: row.capability ?? null,
      status: CARD_STATUS_VALUES.includes(row.status) ? row.status : CARD_STATUS.IDLE,
      reason: row.reason ?? null,
      message: row.message ?? null,
    }));
}

/** 不可用卡片即使被展开也不能发出数据请求。 */
export function shouldRequestCard(cardDef, capabilitySet) {
  if (!cardDef) return false;
  if (cardDef.status === CARD_STATUS.UNSUPPORTED) return false;
  if (typeof cardDef.capability === 'string') {
    return capabilitySet?.[cardDef.capability] === true;
  }
  return true;
}

// ── 适配器校验 ──────────────────────────────────────────────────────────

const REQUIRED_METHODS = [
  'resolve',
  'loadField',
  'loadPointSeries',
  'loadRegionalSeries',
  'validateField',
  'validatePointSeries',
  'validateRegionalSeries',
];

export function validateOverviewAdapter(adapter) {
  const errors = [];
  if (!isPlainObject(adapter)) {
    return { ok: false, errors: ['adapter must be an object'] };
  }
  if (!PLANETS.includes(adapter.planet)) {
    errors.push(`planet must be one of ${PLANETS.join('/')}`);
  }
  if (typeof adapter.sourceId !== 'string' || !adapter.sourceId) {
    errors.push('sourceId must be a non-empty string');
  }
  for (const method of REQUIRED_METHODS) {
    if (typeof adapter[method] !== 'function') {
      errors.push(`${method} must be a function`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * 场景身份。星球切换、发布指纹变化、数据集变化都必须被视为不同身份，
 * 旧响应不得写入新身份的状态。
 */
export function sceneIdentity({ planet, sourceId, sourceFingerprint }) {
  if (!PLANETS.includes(planet)) return null;
  if (typeof sourceId !== 'string' || !sourceId) return null;
  if (typeof sourceFingerprint !== 'string' || !sourceFingerprint) return null;
  return `${planet}|${sourceId}|${sourceFingerprint}`;
}

/** 请求身份：与后端参数一一对应，用于回包校验。 */
export function requestIdentity(parts) {
  return parts.map((part) => (part === null || part === undefined ? '-' : String(part))).join('|');
}

// ── 默认选择 ────────────────────────────────────────────────────────────

export function normalizeSelection(adapter, selection, { previous = null } = {}) {
  const variables = Array.isArray(adapter?.variables) ? adapter.variables : [];
  const ids = variables.map((item) => item.id);
  const fallbackVariable = adapter?.defaults?.variable && ids.includes(adapter.defaults.variable)
    ? adapter.defaults.variable
    : ids[0] || null;
  const variable = ids.includes(selection?.variable)
    ? selection.variable
    : (ids.includes(previous?.variable) ? previous.variable : fallbackVariable);

  const values = timeValues(adapter?.time);
  const fallbackValue = adapter?.defaults?.value ?? values[0] ?? null;
  const requested = selection?.value ?? previous?.value ?? null;
  const value = values.includes(requested) ? requested : fallbackValue;

  const point = isPlainObject(selection?.point)
    && isFiniteNumber(selection.point.lat)
    && isFiniteNumber(selection.point.lon)
    ? { lat: selection.point.lat, lon: selection.point.lon }
    : (isPlainObject(previous?.point) ? { ...previous.point } : null);

  const mode = MODE_IDS.includes(selection?.mode)
    ? selection.mode
    : (MODE_IDS.includes(previous?.mode) ? previous.mode : (MODE_IDS.includes(adapter?.defaults?.mode) ? adapter.defaults.mode : MODE_IDS[0]));

  return { variable, value, point, mode, year: selection?.year ?? previous?.year ?? null };
}

/**
 * 年 / 日一致性：切换年份保留月日，目标年没有该日期时取该月最后一天
 * （2020-02-29 → 2021-02-28），绝不落到 3 月 1 日。
 */
export function dateInSelectedYear(date, year) {
  if (!isValidIsoDate(date) || !Number.isInteger(year)) return null;
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const safeDay = Math.min(day, lastDay);
  const candidate = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`;
  return isValidIsoDate(candidate) ? candidate : null;
}

export function yearOfIsoDate(date) {
  return isValidIsoDate(date) ? Number(date.slice(0, 4)) : null;
}

export function yearsInTimeModel(time) {
  if (Array.isArray(time?.years) && time.years.length) {
    return time.years.filter((year) => Number.isInteger(year));
  }
  const years = new Set();
  for (const value of timeValues(time)) {
    if (isIsoTimeModel(time)) years.add(Number(value.slice(0, 4)));
  }
  return Array.from(years).sort((a, b) => a - b);
}

/**
 * 第一年与第二年之间不自动跳转：调用方必须显式请求“下一年”。
 */
export function nextYearInTimeModel(time, year) {
  const years = yearsInTimeModel(time);
  const index = years.indexOf(year);
  if (index < 0 || index === years.length - 1) return null;
  return years[index + 1];
}

export function previousYearInTimeModel(time, year) {
  const years = yearsInTimeModel(time);
  const index = years.indexOf(year);
  if (index <= 0) return null;
  return years[index - 1];
}
