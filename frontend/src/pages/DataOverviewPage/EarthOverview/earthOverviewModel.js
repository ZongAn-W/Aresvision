/**
 * 二维地球总览的纯逻辑：日期运算、请求身份、payload 校验、播放步进。
 *
 * 全部使用 UTC 日期运算，不使用 toLocaleDateString，避免时区把日期推前一天。
 */

const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const EARTH_3HOURLY_DATASET_ID = 'earth_merra2_3hourly_v1';
export const EARTH_DATASET_ID = EARTH_3HOURLY_DATASET_ID;
export const EARTH_OVERVIEW_DATASETS = [EARTH_3HOURLY_DATASET_ID];

export function resolveEarthDatasetId(catalog, preferredId = null) {
  const earthIds = new Set((catalog?.items || [])
    .filter((item) => item?.planet === 'earth'
      && EARTH_OVERVIEW_DATASETS.includes(item.dataset_id))
    .map((item) => item.dataset_id));
  if (preferredId && earthIds.has(preferredId)) return preferredId;
  const configuredDefault = catalog?.default_earth_dataset_id;
  return earthIds.has(configuredDefault) ? configuredDefault
    : (earthIds.has(EARTH_3HOURLY_DATASET_ID) ? EARTH_3HOURLY_DATASET_ID : null);
}

export function isThreeHourlyDataset(datasetId) {
  return datasetId === EARTH_3HOURLY_DATASET_ID;
}

export function isValidUtcTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().replace('.000Z', 'Z') === value;
}

export function isValidEarthTime(value) {
  return isValidIsoDate(value) || isValidUtcTimestamp(value);
}

export function earthTimeAtIndex(start, index, frequencyHours = 24) {
  if (isValidIsoDate(start) && frequencyHours === 24) return dateAtIndex(start, index);
  if (!isValidUtcTimestamp(start) || !Number.isInteger(index) || frequencyHours !== 3) throw new Error('Invalid UTC step');
  return new Date(Date.parse(start) + index * 3 * 3_600_000).toISOString().replace('.000Z', 'Z');
}

export function earthTimeIndex(start, end, value, frequencyHours = 24) {
  if (frequencyHours === 24) return dateIndexWithin(start, end, value);
  if (frequencyHours !== 3 || ![start, end, value].every(isValidUtcTimestamp)) return null;
  const index = (Date.parse(value) - Date.parse(start)) / (3 * 3_600_000);
  const total = (Date.parse(end) - Date.parse(start)) / (3 * 3_600_000);
  return Number.isInteger(index) && Number.isInteger(total) && index >= 0 && index <= total ? index : null;
}

export function earthTimeValues(start, end, frequencyHours = 24) {
  const last = earthTimeIndex(start, end, end, frequencyHours);
  return last === null ? [] : Array.from({ length: last + 1 }, (_, index) => earthTimeAtIndex(start, index, frequencyHours));
}

export function formatEarthTime(value) {
  return isValidUtcTimestamp(value) ? `${value.slice(0, 10)} ${value.slice(11, 16)} UTC` : value || '--';
}

export const EARTH_VARIABLES = ['TO3', 'U10M', 'V10M', 'T2M', 'SWGDN'];
export const WIND_VARIABLES = ['U10M', 'V10M'];

export const DEFAULT_VARIABLE = 'TO3';

/** 火星单位设置不作用于地球：这里固定使用原始物理单位。 */
export const EARTH_VARIABLE_UNITS = {
  TO3: 'DU',
  U10M: 'm s-1',
  V10M: 'm s-1',
  T2M: 'K',
  SWGDN: 'W m-2',
};

export const EARTH_VARIABLE_LABEL_KEYS = {
  TO3: 'earthOverview.variables.TO3',
  U10M: 'earthOverview.variables.U10M',
  V10M: 'earthOverview.variables.V10M',
  T2M: 'earthOverview.variables.T2M',
  SWGDN: 'earthOverview.variables.SWGDN',
};

export function earthColormap(variable, userColormap) {
  // Wind components are signed, so they use the diverging scale with zero in
  // the middle instead of the user's sequential ramp.
  if (WIND_VARIABLES.includes(variable)) return 'rdbu';
  return userColormap || 'inferno';
}

export function isoDayNumber(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) {
    throw new Error('Invalid ISO date');
  }
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
    throw new Error('Invalid ISO date');
  }
  return timestamp / DAY_MS;
}

export function dateAtIndex(start, index) {
  if (!Number.isInteger(index)) throw new Error('Invalid day index');
  return new Date((isoDayNumber(start) + index) * DAY_MS).toISOString().slice(0, 10);
}

export function isValidIsoDate(value) {
  try {
    isoDayNumber(value);
    return true;
  } catch {
    return false;
  }
}

/** 当前日期在元数据日期范围内的位置；越界返回 null 而不夹取。 */
export function dateIndexWithin(start, end, value) {
  if (!isValidIsoDate(value) || !isValidIsoDate(start) || !isValidIsoDate(end)) return null;
  const index = isoDayNumber(value) - isoDayNumber(start);
  const total = isoDayNumber(end) - isoDayNumber(start);
  if (index < 0 || index > total) return null;
  return index;
}

/** 日期 ± n 天，始终返回 ISO 日期字符串。 */
export function shiftDate(value, days) {
  return dateAtIndex(value, days);
}

export function nextPlaybackDate({ start, end, displayedDate, requestedDate, ready, playing, frequencyHours = 24 }) {
  if (!playing || !ready || displayedDate !== requestedDate || displayedDate >= end) return null;
  const index = earthTimeIndex(start, end, displayedDate, frequencyHours);
  return index === null ? null : earthTimeAtIndex(start, index + 1, frequencyHours);
}

/**
 * 请求身份：与后端参数同名，用于判断回包是否仍对应当前选择。
 */
export function fieldIdentity({ datasetId, fingerprint, variable, date }) {
  return [datasetId, fingerprint, variable, date].join('|');
}

export function regionalIdentity({ datasetId, fingerprint, variable, start, end }) {
  return [datasetId, fingerprint, variable, start, end].join('|');
}

export function pointIdentity({ datasetId, fingerprint, variable, lat, lon, start, end }) {
  return [datasetId, fingerprint, variable, lat, lon, start, end].join('|');
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isAscendingUnique(values) {
  if (!Array.isArray(values) || values.length < 2) return false;
  for (let i = 1; i < values.length; i += 1) {
    if (!isFiniteNumber(values[i]) || values[i] <= values[i - 1]) return false;
  }
  return isFiniteNumber(values[0]);
}

function identityMatches(payload, { datasetId, fingerprint, variable, units }) {
  if (!payload || typeof payload !== 'object') return false;
  if (payload.dataset_id !== datasetId) return false;
  if (payload.dataset_fingerprint !== fingerprint) return false;
  if (payload.variable !== variable) return false;
  if (payload.planet !== 'earth') return false;
  if (units !== undefined && payload.units !== units) return false;
  return true;
}

/** 成功还要核对字段、维度与长度，不能只看 HTTP 200。 */
export function isValidFieldPayload(payload, expected) {
  if (!identityMatches(payload, expected)) return false;
  if (payload.units !== EARTH_VARIABLE_UNITS[expected.variable]) return false;
  if (payload.date !== expected.date) return false;
  const threeHourly = isThreeHourlyDataset(expected.datasetId);
  if (threeHourly && (!validThreeHourlyMetadata(payload) || payload.timestamp !== expected.date)) return false;
  if (payload.dimension_order?.join(',') !== 'lat,lon') return false;
  if (!isAscendingUnique(payload.lat) || !isAscendingUnique(payload.lon)) return false;
  if (!Array.isArray(payload.field) || payload.field.length !== payload.lat.length) return false;
  const width = payload.lon.length;
  for (const row of payload.field) {
    if (!Array.isArray(row) || row.length !== width) return false;
    for (const value of row) if (!isFiniteNumber(value) && !(threeHourly && value === null)) return false;
  }
  const coverage = payload.coverage;
  const expectedWrap = expected.datasetId === 'earth_merra2_daily_v1' ? false : true;
  if (!coverage || coverage.wrap_longitude !== expectedWrap) return false;
  if (!Array.isArray(coverage.latitude_range) || coverage.latitude_range.length !== 2) return false;
  if (!Array.isArray(coverage.longitude_range) || coverage.longitude_range.length !== 2) return false;
  if (!isFiniteNumber(coverage.latitude_range[0]) || !isFiniteNumber(coverage.latitude_range[1])) return false;
  if (!isFiniteNumber(coverage.longitude_range[0]) || !isFiniteNumber(coverage.longitude_range[1])) return false;
  if (expectedWrap) {
    if (coverage.latitude_range.join(',') !== '-90,90' || coverage.longitude_range.join(',') !== '-180,180') return false;
    const shape = threeHourly ? payload.render_grid_shape : [36, 72];
    if (!Array.isArray(shape) || shape.length !== 2 || payload.lat.length !== shape[0] || payload.lon.length !== shape[1]) return false;
    const step = threeHourly ? (shape.join(',') === '60,120' ? 3 : shape.join(',') === '30,60' ? 6 : 0.75) : 5;
    if (threeHourly && (!['60,120', '30,60', '240,480'].includes(shape.join(',')) || payload.source_grid_shape?.join(',') !== '240,480')) return false;
    if (threeHourly && shape.join(',') !== '240,480') {
      const stride = shape[0] === 60 ? 4 : 8;
      const namedMethod = payload.render_method === `spherical_cell_area_mean_${stride}x${stride}`;
      const blockMethod = payload.render?.method === 'spherical_cell_area_block_mean' && payload.render.block_shape?.join(',') === `${stride},${stride}`;
      if (!namedMethod && !blockMethod) return false;
    }
    if (payload.lat.some((v, i) => v !== -90 + step / 2 + i * step) || payload.lon.some((v, i) => v !== -180 + step / 2 + i * step)) return false;
  }
  if (!payload.color_range || !isFiniteNumber(payload.color_range.min)) return false;
  if (!isFiniteNumber(payload.color_range.max)) return false;
  if (!payload.statistics || (!isFiniteNumber(payload.statistics.regional_mean) && !(threeHourly && payload.statistics.regional_mean === null))) return false;
  return true;
}

function validThreeHourlyMetadata(payload) {
  return payload.frequency_hours === 3 && payload.step_unit === 'hour' && payload.step === 3 && payload.time_zone === 'UTC';
}

function isValidSeriesDates(dates, start, end, threeHourly = false) {
  if (!Array.isArray(dates) || dates.length === 0) return false;
  let previous = null;
  for (const value of dates) {
    if (!(threeHourly ? isValidUtcTimestamp(value) : isValidIsoDate(value))) return false;
    if (previous !== null && (threeHourly ? Date.parse(value) - Date.parse(previous) !== 3 * 3_600_000 : isoDayNumber(value) !== isoDayNumber(previous) + 1)) return false;
    previous = value;
  }
  if (start !== undefined && dates[0] !== start) return false;
  if (end !== undefined && dates[dates.length - 1] !== end) return false;
  return true;
}

export function isValidRegionalPayload(payload, expected) {
  if (!identityMatches(payload, expected)) return false;
  if (!['cos_lat_sample_mean', 'spherical_cell_area_mean'].includes(payload.aggregation)) return false;
  const threeHourly = isThreeHourlyDataset(expected.datasetId);
  if (threeHourly && (!validThreeHourlyMetadata(payload) || JSON.stringify(payload.timestamps) !== JSON.stringify(payload.dates))) return false;
  if (!isValidSeriesDates(payload.dates, expected.start, expected.end, threeHourly)) return false;
  if (!Array.isArray(payload.values) || payload.values.length !== payload.dates.length) return false;
  return payload.values.every((value) => isFiniteNumber(value) || (threeHourly && value === null));
}

export function isValidPointPayload(payload, expected) {
  if (!identityMatches(payload, expected)) return false;
  if (payload.selection !== 'nearest_grid_point') return false;
  const threeHourly = isThreeHourlyDataset(expected.datasetId);
  if (threeHourly && (!validThreeHourlyMetadata(payload) || JSON.stringify(payload.timestamps) !== JSON.stringify(payload.dates))) return false;
  if (!isValidSeriesDates(payload.dates, expected.start, expected.end, threeHourly)) return false;
  if (!Array.isArray(payload.values) || payload.values.length !== payload.dates.length) return false;
  if (!payload.values.every((value) => isFiniteNumber(value) || (threeHourly && value === null))) return false;
  const grid = payload.grid_point;
  if (!grid || !isFiniteNumber(grid.lat) || !isFiniteNumber(grid.lon)) return false;
  if (!Number.isInteger(grid.lat_index) || !Number.isInteger(grid.lon_index)) return false;
  if (threeHourly && (grid.lat_index < 0 || grid.lat_index >= 240 || grid.lon_index < 0 || grid.lon_index >= 480
    || grid.lat !== -89.625 + grid.lat_index * 0.75 || grid.lon !== -179.625 + grid.lon_index * 0.75)) return false;
  return true;
}

/** descriptor 缺动态字段时不发数据请求。 */
export function canRequestEarthData(descriptor) {
  if (!descriptor || !EARTH_OVERVIEW_DATASETS.includes(descriptor.dataset_id)) return false;
  if (descriptor.availability !== 'available') return false;
  if (descriptor.capabilities?.web_overview !== true) return false;
  if (typeof descriptor.dataset_fingerprint !== 'string') return false;
  if (descriptor.dataset_fingerprint.length !== 64) return false;
  if (!descriptor.time?.start || !descriptor.time?.end) return false;
  if (!Array.isArray(descriptor.channel_order) || descriptor.channel_order.length === 0) return false;
  if (isThreeHourlyDataset(descriptor.dataset_id) && (descriptor.frequency_hours !== 3 || earthTimeIndex(descriptor.time.start, descriptor.time.end, descriptor.time.end, 3) === null)) return false;
  return true;
}

/** 从 descriptor 派生页面初始选择，不写死日期或变量。 */
export function initialEarthSelection(descriptor, previous) {
  const start = descriptor?.time?.start ?? null;
  const end = descriptor?.time?.end ?? null;
  const variable = EARTH_VARIABLES.includes(previous?.variable) ? previous.variable : DEFAULT_VARIABLE;
  const keepDate = previous?.date && earthTimeIndex(start, end, previous.date, descriptor?.frequency_hours || 24) !== null
    ? previous.date
    : null;
  const point = previous?.point
    && isFiniteNumber(previous.point.lat)
    && isFiniteNumber(previous.point.lon)
    ? { lat: previous.point.lat, lon: previous.point.lon }
    : null;
  return { date: keepDate || start, variable, point };
}

export function formatEarthNumber(value, digits = 2) {
  if (!isFiniteNumber(value)) return '--';
  return value.toFixed(digits);
}
