/**
 * Earth 适配器：把 MERRA-2 日平均 v2 数据接入共用分析工作台。
 *
 * 语义边界（与 Mars 严格隔离）：
 * - 时间使用 ISO 日期，绝不转换成 MY / Ls；
 * - 数值使用原始物理单位（DU / m s-1 / K / W m-2），不套用火星单位换算；
 * - 几何为 v2 全球 36×72、5°×5°、−90…90 / −180…180，不使用旧 v1 的区域裁剪；
 * - 日平均数据不伪装成昼夜变化，昼夜卡片固定为 unsupported，且不请求 Mars 接口。
 */

import C from '../../../constants/colors.js';
import { fetchDataset, fetchEarthField, fetchEarthPointSeries, fetchEarthRegionalSeries, fetchEarthOverviewContext } from '../../../services/datasets.js';
import {
  EARTH_DATASET_ID,
  EARTH_VARIABLES,
  EARTH_VARIABLE_UNITS,
  canRequestEarthData,
  earthColormap,
  isValidFieldPayload,
  isValidPointPayload,
  isValidRegionalPayload,
  isoDayNumber,
} from '../EarthOverview/earthOverviewModel.js';
import {
  CAPABILITY_REASONS,
  CARD_STATUS,
  nearestGeometryCell,
} from './OverviewAdapter.js';
import { createEarthResearchClient } from '../EarthOverview/earthResearchClient.js';

const CARD_TITLES = {
  seasonal: { zh: '季节结构', en: 'Seasonal structure' },
  globalTrend: { zh: '年内全球变化', en: 'Annual global change' },
  seasonalExtremes: { zh: '季节极值', en: 'Seasonal extremes' },
  environment: { zh: '环境因子', en: 'Environmental factors' },
  polar: { zh: '极区统计', en: 'Polar statistics' },
  diurnal: { zh: '昼夜变化', en: 'Diurnal cycle' },
  solarsens: { zh: '地表短波辐射–O3关系', en: 'Surface shortwave – O3' },
  correlation: { zh: '变量相关性', en: 'Variable correlation' },
  coupling: { zh: '温度–O3耦合', en: 'Temperature – O3 coupling' },
  wave: { zh: '空间距平与纬带诊断', en: 'Spatial anomaly and band diagnostics' },
};

function card(key, color, capability, extra = {}) {
  return { key, title: CARD_TITLES[key], color, capability, ...extra };
}

function allDatesBetween(start, end) {
  if (typeof start !== 'string' || typeof end !== 'string') return [];
  const values = [];
  const last = isoDayNumber(end);
  for (let index = isoDayNumber(start); index <= last; index += 1) {
    values.push(new Date(index * 86_400_000).toISOString().slice(0, 10));
  }
  return values;
}

function buildGeometry(context, descriptor) {
  const grid = descriptor?.grid || {};
  const centers = context?.geometry || {};
  const latCenters = Array.isArray(centers.lat_centers)
    ? centers.lat_centers
    : (Array.isArray(grid.latitude_values) ? grid.latitude_values : null);
  const lonCenters = Array.isArray(centers.lon_centers)
    ? centers.lon_centers
    : (Array.isArray(grid.longitude_values) ? grid.longitude_values : null);
  if (!latCenters || !lonCenters) return null;
  const latBounds = Array.isArray(centers.lat_bounds) && centers.lat_bounds.length === 2
    ? centers.lat_bounds
    : (grid.cell_bounds?.latitude || grid.latitude_range || null);
  const lonBounds = Array.isArray(centers.lon_bounds) && centers.lon_bounds.length === 2
    ? centers.lon_bounds
    : (grid.cell_bounds?.longitude || grid.longitude_range || null);
  if (!latBounds || !lonBounds) return null;
  return {
    planet: 'earth',
    latCenters,
    lonCenters,
    latBounds,
    lonBounds,
    wrapLongitude: centers.wrap_longitude ?? grid.wrap_longitude ?? true,
    shape: [latCenters.length, lonCenters.length],
    dimensionOrder: ['lat', 'lon'],
  };
}

function buildVariables(context, descriptor) {
  const declared = Array.isArray(context?.variables) && context.variables.length
    ? context.variables
    : (descriptor?.variables || []);
  const byId = new Map(declared.map((item) => [item.id, item]));
  return EARTH_VARIABLES.map((id) => {
    const entry = byId.get(id) || {};
    return {
      id,
      label: entry.label || id,
      unit: entry.units || EARTH_VARIABLE_UNITS[id] || '',
      colormap: earthColormap(id, null),
      centeredOnZero: Boolean(entry.color_range?.centered_on_zero) || id === 'U10M' || id === 'V10M',
      range: entry.color_range
        ? { min: entry.color_range.min, max: entry.color_range.max }
        : null,
    };
  });
}

export function buildEarthCards() {
  return {
    temporal: [
      card('seasonal', C.blue, 'researchSuite'),
      card('globalTrend', C.green, 'researchSuite'),
      card('seasonalExtremes', '#f09c4a', 'researchSuite'),
      card('environment', C.green, 'researchSuite'),
      card('polar', '#cbeef3', 'polar'),
      card('diurnal', C.mars, 'diurnal', {
        status: CARD_STATUS.UNSUPPORTED,
        reason: CAPABILITY_REASONS.DIURNAL_DAILY_MEAN,
      }),
    ],
    drivers: [
      card('solarsens', '#d9a441', 'researchSuite'),
      card('correlation', C.blue, 'researchSuite'),
      card('coupling', '#ffb347', 'researchSuite'),
    ],
    dynamics: [
      card('wave', '#d2b48c', 'spatialDiagnostics'),
    ],
  };
}

/**
 * @param {{ datasetId?: string }} [options]
 * @returns {object} 满足 OverviewAdapter 契约的 Earth 适配器。
 */
export function createEarthOverviewAdapter({ datasetId = EARTH_DATASET_ID } = {}) {
  let researchClient = null;
  let researchKey = null;
  let resolvedFingerprint = null;

  const clientFor = (fingerprint) => {
    const key = `${datasetId}|${fingerprint ?? ''}`;
    if (!researchClient || researchKey !== key) {
      researchClient?.invalidate();
      researchClient = createEarthResearchClient({ datasetId, fingerprint });
      researchKey = key;
    }
    return researchClient;
  };

  return {
    planet: 'earth',
    sourceId: datasetId,
    sourceLabel: 'MERRA-2 daily global 5° compact v2',

    async resolve({ signal } = {}) {
      const descriptor = await fetchDataset(datasetId, { signal });
      if (signal?.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
      if (!canRequestEarthData(descriptor)) {
        return {
          status: 'unsupported',
          statusDetail: descriptor?.availability_reason || 'dataset_unavailable',
          sourceLabel: descriptor?.display_name || datasetId,
          limitations: descriptor?.limitations || [],
        };
      }

      const fingerprint = descriptor.dataset_fingerprint;
      // 数据源身份变化时立即失效旧的年度分析缓存与在途请求。
      clientFor(fingerprint);
      resolvedFingerprint = fingerprint;

      const context = await fetchEarthOverviewContext(datasetId, { fingerprint, signal });
      if (signal?.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' });

      const geometry = buildGeometry(context, descriptor);
      const time = context?.time || {};
      const start = time.start || descriptor.time?.start || null;
      const end = time.end || descriptor.time?.end || null;

      return {
        status: 'ready',
        statusDetail: null,
        sourceLabel: descriptor.display_name || 'MERRA-2 daily global 5° compact v2',
        sourceFingerprint: fingerprint,
        sourceMeta: context?.source_meta || null,
        limitations: context?.limitations || descriptor.limitations || [],
        time: {
          kind: 'iso-date',
          calendar: time.calendar || 'proleptic_gregorian',
          start,
          end,
          values: allDatesBetween(start, end),
          years: Array.isArray(time.years) && time.years.length
            ? time.years
            : Array.from(new Set(allDatesBetween(start, end).map((value) => Number(value.slice(0, 4))))),
          step: time.step ?? 1,
          stepUnit: time.step_unit || 'day',
        },
        variables: buildVariables(context, descriptor),
        geometry,
        capabilities: {
          field: true,
          playback: true,
          pointProbe: true,
          polar: context?.capabilities?.polar !== false,
          // 日平均数据没有日内采样：该能力位必须为 false，且不得回退到 Mars 昼夜接口。
          diurnal: false,
          researchSuite: context?.capabilities?.researchSuite !== false,
          spatialDiagnostics: context?.capabilities?.spatialDiagnostics !== false,
          aiInsight: context?.capabilities?.aiInsight !== false,
        },
        capabilityReasons: {
          diurnal: context?.unavailable?.diurnal || CAPABILITY_REASONS.DIURNAL_DAILY_MEAN,
        },
        polarScope: context?.polar_scope || null,
        cards: buildEarthCards(),
        defaults: { variable: 'TO3', value: start, mode: 'temporal' },
      };
    },

    // ── 逐日场 / 序列 ──────────────────────────────────────────────
    loadField({ value, variable, signal }) {
      return fetchEarthField(datasetId, {
        variable, date: value, fingerprint: resolvedFingerprint, signal,
      });
    },

    loadRegionalSeries({ variable, signal }) {
      return fetchEarthRegionalSeries(datasetId, {
        variable, fingerprint: resolvedFingerprint, signal,
      });
    },

    loadPointSeries({ lat, lon, variable, signal }) {
      return fetchEarthPointSeries(datasetId, {
        variable, lat, lon, fingerprint: resolvedFingerprint, signal,
      });
    },

    validateField(payload, expected) {
      return isValidFieldPayload(payload, {
        datasetId,
        fingerprint: expected.sourceFingerprint,
        variable: expected.variable,
        date: expected.value,
      });
    },

    validateRegionalSeries(payload, expected) {
      return isValidRegionalPayload(payload, {
        datasetId, fingerprint: expected.sourceFingerprint, variable: expected.variable,
      });
    },

    validatePointSeries(payload, expected) {
      return isValidPointPayload(payload, {
        datasetId, fingerprint: expected.sourceFingerprint, variable: expected.variable,
      });
    },

    normalizeField(payload) {
      return {
        value: payload.date,
        date: payload.date,
        variable: payload.variable,
        unit: payload.units,
        units: payload.units,
        values: payload.field,
        latCenters: payload.lat,
        lonCenters: payload.lon,
        colorRange: {
          min: payload.color_range.min,
          max: payload.color_range.max,
          centeredOnZero: payload.color_range.centered_on_zero,
          scope: payload.color_range.scope,
        },
        coverage: payload.coverage,
        statistics: payload.statistics,
      };
    },

    normalizeRegionalSeries(payload) {
      return {
        dates: payload.dates,
        values: payload.values,
        unit: payload.units,
        aggregation: payload.aggregation,
        coverage: payload.coverage,
      };
    },

    normalizePointSeries(payload) {
      return {
        dates: payload.dates,
        values: payload.values,
        unit: payload.units,
        requested: payload.requested,
        gridPoint: payload.grid_point,
        selection: payload.selection,
      };
    },

    cellForPoint(geometry, point) {
      const cell = nearestGeometryCell(geometry, point?.lat, point?.lon);
      if (!cell) return null;
      return { lat: cell.lat, lon: cell.lon, row: cell.row, col: cell.col };
    },

    /**
     * 卡片数据加载。昼夜卡片永不发起请求（在 controller 中已被 capability 拦下），
     * 这里再显式返回 unsupported，保证任何调用路径都不会请求 Mars 昼夜接口。
     */
    async loadCard({ cardKey, variable, year, signal }) {
      if (cardKey === 'diurnal') {
        return { status: 'unsupported', reason: CAPABILITY_REASONS.DIURNAL_DAILY_MEAN };
      }
      const client = clientFor(resolvedFingerprint);
      if (!Number.isInteger(year)) {
        return { status: 'unsupported', reason: 'year_not_selected' };
      }
      if (cardKey === 'wave') {
        const payload = await client.getSpatial({ year, variable, signal });
        return { data: payload };
      }
      if (cardKey === 'polar') {
        const payload = await client.getPolar({ year, signal });
        return { data: payload };
      }
      const payload = await client.getSuite({ year, signal });
      return { data: payload };
    },

    invalidateResearch() {
      researchClient?.invalidate();
    },
  };
}

export default createEarthOverviewAdapter;
