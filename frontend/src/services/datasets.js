/**
 * 服务器数据集目录与二维地球总览 API 封装
 *
 * 公开只读读取，不经过 api.js 的认证/全局错误语义；错误保留结构化 code/status，
 * AbortError 原样抛出，便于调用方区分"取消"与"失败"。
 */

const BASE = '/api';

export class DatasetApiError extends Error {
  constructor(message, { code = 'invalid_request', status = 0, availabilityReason = null } = {}) {
    super(message);
    this.name = 'DatasetApiError';
    this.code = code;
    this.status = status;
    this.availabilityReason = availabilityReason;
  }
}

function describeDetail(detail) {
  if (typeof detail === 'string' && detail.trim()) return detail.trim();
  if (Array.isArray(detail)) {
    // Pydantic validation array: keep the field names readable.
    const parts = detail
      .map((item) => {
        const loc = Array.isArray(item?.loc) ? item.loc.filter((p) => p !== 'query').join('.') : '';
        const msg = item?.msg || '';
        return loc ? `${loc}: ${msg}` : msg;
      })
      .filter(Boolean);
    if (parts.length) return parts.join('; ');
  }
  return '';
}

async function readError(response) {
  const payload = await response.json().catch(() => null);
  const detail = payload?.detail;
  const structured = detail && typeof detail === 'object' && !Array.isArray(detail) ? detail : null;
  const message = describeDetail(structured ? structured.message : detail)
    || `${response.status} ${response.statusText}`.trim();
  return new DatasetApiError(message, {
    code: structured?.code || 'invalid_request',
    status: response.status,
    availabilityReason: structured?.availability_reason ?? null,
  });
}

async function readJson(url, { signal } = {}) {
  let response;
  try {
    response = await fetch(url, { signal });
  } catch (error) {
    // AbortError must stay an AbortError so callers can ignore it.
    if (error?.name === 'AbortError') throw error;
    throw new DatasetApiError('Network request failed', { code: 'network_error' });
  }
  if (!response.ok) throw await readError(response);
  try {
    return await response.json();
  } catch {
    throw new DatasetApiError('Invalid JSON response', {
      code: 'invalid_response',
      status: response.status,
    });
  }
}

const DATASETS_PATH = `${BASE}/datasets`;

function overviewPath(datasetId, resource) {
  return `${DATASETS_PATH}/${encodeURIComponent(datasetId)}/overview/${resource}`;
}

function withQuery(path, entries) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(entries)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export function fetchDatasets({ signal } = {}) {
  return readJson(DATASETS_PATH, { signal });
}

export function fetchDataset(datasetId, { signal } = {}) {
  return readJson(`${DATASETS_PATH}/${encodeURIComponent(datasetId)}`, { signal });
}

export function fetchEarthField(datasetId, { variable, date, fingerprint, signal } = {}) {
  return readJson(withQuery(overviewPath(datasetId, 'field'), {
    variable,
    date,
    expected_fingerprint: fingerprint,
  }), { signal });
}

export function fetchEarthRegionalSeries(datasetId, {
  variable, fingerprint, start, end, signal,
} = {}) {
  return readJson(withQuery(overviewPath(datasetId, 'regional-series'), {
    variable,
    expected_fingerprint: fingerprint,
    start,
    end,
  }), { signal });
}

export function fetchEarthPointSeries(datasetId, {
  variable, lat, lon, fingerprint, start, end, signal,
} = {}) {
  return readJson(withQuery(overviewPath(datasetId, 'point-series'), {
    variable,
    lat,
    lon,
    expected_fingerprint: fingerprint,
    start,
    end,
  }), { signal });
}
