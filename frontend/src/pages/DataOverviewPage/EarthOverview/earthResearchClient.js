/**
 * Earth 年度分析数据客户端。
 *
 * 年度 suite 与空间诊断按 (fingerprint, year[, variable]) 缓存并去重：
 * 多个卡片共享同一次请求，逐日播放不会重复请求年度数据。
 * 发布指纹或年份变化时整体失效，旧 payload 不会被贴到新年份的图表上。
 *
 * 客户端自持 AbortController；调用方的 signal 只用于放弃“应用结果”，
 * 因此一张卡片卸载不会中断其它卡片仍在等待的同一个请求。
 */

import {
  DatasetApiError,
  fetchEarthPolarDynamics,
  fetchEarthResearchSuite,
  fetchEarthSpatialDiagnostics,
} from '../../../services/datasets.js';

function abortError() {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

function assertIdentity(payload, { datasetId, fingerprint, year }) {
  if (!payload || typeof payload !== 'object') {
    throw new DatasetApiError('Empty analysis payload', { code: 'invalid_response' });
  }
  if (payload.planet !== 'earth') {
    throw new DatasetApiError('Analysis payload is not Earth data', { code: 'invalid_response' });
  }
  if (payload.dataset_id !== datasetId) {
    throw new DatasetApiError('Analysis payload dataset mismatch', { code: 'invalid_response' });
  }
  if (fingerprint && payload.dataset_fingerprint !== fingerprint) {
    throw new DatasetApiError('Analysis payload version changed', { code: 'invalid_response' });
  }
  if (Number.isInteger(year) && payload.year !== year) {
    throw new DatasetApiError('Analysis payload year mismatch', { code: 'invalid_response' });
  }
  return payload;
}

/** 年度 suite 的形状校验：日期连续、季节矩阵方向与单位齐全。 */
export function validateResearchSuite(payload, { datasetId, fingerprint, year }) {
  assertIdentity(payload, { datasetId, fingerprint, year });
  if (!Array.isArray(payload.dates) || payload.dates.length !== payload.day_count) {
    throw new DatasetApiError('Invalid suite dates', { code: 'invalid_response' });
  }
  if (!Array.isArray(payload.latitude) || payload.latitude.length < 2) {
    throw new DatasetApiError('Invalid suite latitude axis', { code: 'invalid_response' });
  }
  const shape = payload.seasonal || {};
  for (const [variableId, entry] of Object.entries(shape)) {
    if (!Array.isArray(entry?.z) || entry.z.length !== payload.latitude.length) {
      throw new DatasetApiError(`Invalid seasonal matrix for ${variableId}`, { code: 'invalid_response' });
    }
    const width = entry.z[0]?.length;
    if (width !== payload.day_count || entry.z.some((row) => row.length !== width)) {
      throw new DatasetApiError(`Invalid seasonal width for ${variableId}`, { code: 'invalid_response' });
    }
  }
  if (!Array.isArray(payload.bands) || payload.bands.length === 0) {
    throw new DatasetApiError('Invalid suite bands', { code: 'invalid_response' });
  }
  return payload;
}

export function validateSpatialDiagnostics(payload, { datasetId, fingerprint, year, variable }) {
  assertIdentity(payload, { datasetId, fingerprint, year });
  if (payload.variable !== variable) {
    throw new DatasetApiError('Spatial payload variable mismatch', { code: 'invalid_response' });
  }
  const rows = payload.anomaly;
  if (!Array.isArray(rows) || rows.length !== payload.lat?.length) {
    throw new DatasetApiError('Invalid anomaly matrix', { code: 'invalid_response' });
  }
  const width = payload.lon?.length;
  if (rows.some((row) => !Array.isArray(row) || row.length !== width)) {
    throw new DatasetApiError('Invalid anomaly width', { code: 'invalid_response' });
  }
  return payload;
}

export function validatePolarDynamics(payload, { datasetId, fingerprint, year }) {
  assertIdentity(payload, { datasetId, fingerprint, year });
  if (!Array.isArray(payload.bands) || payload.bands.length === 0) {
    throw new DatasetApiError('Invalid polar bands', { code: 'invalid_response' });
  }
  return payload;
}

export function createEarthResearchClient({ datasetId, fingerprint, fetchImpl = null }) {
  const entries = new Map();
  let generation = 0;

  const load = (key, run, validate) => {
    const existing = entries.get(key);
    if (existing && existing.generation === generation) return existing.promise;

    const controller = new AbortController();
    const promise = run(controller.signal)
      .then((payload) => validate(payload))
      .catch((error) => {
        // 失败不缓存：错误后必须能重试，不能把 rejected promise 永久留住。
        if (entries.get(key)?.promise === promise) entries.delete(key);
        throw error;
      });

    entries.set(key, { promise, controller, generation });
    return promise;
  };

  return {
    getSuite({ year, signal } = {}) {
      const key = `suite:${year}`;
      return load(
        key,
        (requestSignal) => (fetchImpl || fetchEarthResearchSuite)(datasetId, {
          year, fingerprint, signal: requestSignal,
        }),
        (payload) => validateResearchSuite(payload, { datasetId, fingerprint, year }),
      ).then((payload) => {
        if (signal?.aborted) throw abortError();
        return payload;
      });
    },

    getSpatial({ year, variable, signal } = {}) {
      const key = `spatial:${year}:${variable}`;
      return load(
        key,
        (requestSignal) => (fetchImpl || fetchEarthSpatialDiagnostics)(datasetId, {
          year, variable, fingerprint, signal: requestSignal,
        }),
        (payload) => validateSpatialDiagnostics(payload, {
          datasetId, fingerprint, year, variable,
        }),
      ).then((payload) => {
        if (signal?.aborted) throw abortError();
        return payload;
      });
    },

    getPolar({ year, signal } = {}) {
      const key = `polar:${year}`;
      return load(
        key,
        (requestSignal) => (fetchImpl || fetchEarthPolarDynamics)(datasetId, {
          year, fingerprint, signal: requestSignal,
        }),
        (payload) => validatePolarDynamics(payload, { datasetId, fingerprint, year }),
      ).then((payload) => {
        if (signal?.aborted) throw abortError();
        return payload;
      });
    },

    /** 指纹变化、手动重试或组件卸载时调用：取消在途请求并清空缓存。 */
    invalidate() {
      generation += 1;
      for (const entry of entries.values()) entry.controller.abort();
      entries.clear();
    },

    get size() {
      return entries.size;
    },
  };
}
