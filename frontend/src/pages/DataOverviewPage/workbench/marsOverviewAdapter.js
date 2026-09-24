/**
 * Mars 适配器：把现有火星总览状态描述成共用工作台契约。
 *
 * 火星的数据获取、MY/Ls 时间模型、太阳光照、纹理与全部原有卡片都保持原样；
 * 本适配器只声明“场景是什么”，因此共用外壳、模式选择器与卡片外壳可以同时
 * 服务 Mars 与 Earth，而不会改变 Mars 的默认行为。
 */

import C from '../../../constants/colors.js';
import { getCardTitle, getModeCardKeys } from '../overviewChartLayout.js';
import { CARD_STATUS } from './OverviewAdapter.js';

export const MARS_CAPABILITIES = Object.freeze({
  field: true,
  playback: true,
  pointProbe: true,
  polar: true,
  diurnal: true,
  researchSuite: true,
  spatialDiagnostics: true,
  aiInsight: true,
});

export const MARS_CARD_COLORS = Object.freeze({
  realtime: C.mars,
  seasonal: C.blue,
  seasonalExtremes: '#f09c4a',
  globalTrend: C.green,
  environment: C.green,
  solarsens: '#d9a441',
  wave: '#d2b48c',
  polar: '#cbeef3',
  coupling: '#ffb347',
  distribution: C.mars,
  correlation: C.blue,
});

/**
 * Mars 卡片目录。键名与顺序沿用 `overviewChartLayout.MODE_CARD_KEYS`，
 * 旧模块无参数调用仍得到原行为。
 */
export function buildMarsCards() {
  const catalog = {};
  for (const modeId of ['temporal', 'drivers', 'dynamics']) {
    catalog[modeId] = getModeCardKeys(modeId).map((key) => ({
      key,
      title: {
        zh: getCardTitle(key, true),
        en: getCardTitle(key, false),
      },
      color: MARS_CARD_COLORS[key] || C.blue,
      status: CARD_STATUS.READY,
      capability: null,
      reason: null,
    }));
  }
  return catalog;
}

function marsVariableList(variables) {
  if (Array.isArray(variables) && variables.length) return variables;
  return [{ id: 'o3col', label: 'O3 column', unit: 'um-atm', colormap: 'inferno', centeredOnZero: false, range: null }];
}

/**
 * @param {object} scene Mars 当前场景状态（全部可选，缺省时使用火星默认值）。
 * @returns {object} 满足 OverviewAdapter 契约的只读 Mars 适配器。
 */
export function createMarsOverviewAdapter(scene = {}) {
  const {
    marsYear = 27,
    timeline = { min: 0, max: 360, step: 5 },
    lsValues = null,
    sourceMeta = null,
    sourceId = 'mars_overview',
    geometry = null,
    variables = null,
    capabilities = MARS_CAPABILITIES,
  } = scene;

  const ls = Array.isArray(lsValues) && lsValues.length
    ? lsValues
    : (() => {
      const step = Number.isFinite(timeline?.step) && timeline.step > 0 ? timeline.step : 5;
      const min = Number.isFinite(timeline?.min) ? timeline.min : 0;
      const max = Number.isFinite(timeline?.max) ? timeline.max : 360;
      const values = [];
      for (let value = min; value <= max; value += step) values.push(value);
      return values;
    })();

  const fingerprint = sourceMeta?.dataset_fingerprint
    || sourceMeta?.fingerprint
    || `mars-my${marsYear}`;

  const model = {
    status: 'ready',
    statusDetail: null,
    sourceLabel: sourceMeta?.source || `Mars MY${marsYear}`,
    sourceFingerprint: fingerprint,
    sourceMeta,
    limitations: [],
    time: {
      kind: 'mars-year-ls',
      label: `MY${marsYear}`,
      start: ls[0] ?? 0,
      end: ls[ls.length - 1] ?? 360,
      values: ls,
      years: [marsYear],
      step: timeline?.step ?? 5,
      stepUnit: 'ls-degree',
      calendar: 'mars-year-ls',
    },
    variables: marsVariableList(variables),
    geometry,
    capabilities: { ...capabilities },
    capabilityReasons: {},
    polarScope: null,
    cards: buildMarsCards(),
    defaults: { variable: 'o3col', value: ls[0] ?? 0, mode: 'temporal' },
  };

  return {
    planet: 'mars',
    sourceId,
    sourceLabel: model.sourceLabel,

    async resolve() {
      return model;
    },

    // Mars 数据由既有 provider / API 承担：这四条通道保留契约但不再重复请求，
    // 只有显式传入 loaders 时才会被调用（例如未来的离线回放测试）。
    loadField: scene.loadField || (() => Promise.reject(new Error('Mars field is loaded by the existing provider'))),
    loadRegionalSeries: scene.loadRegionalSeries || (() => Promise.reject(new Error('Mars series are loaded by the existing provider'))),
    loadPointSeries: scene.loadPointSeries || (() => Promise.reject(new Error('Mars point probe uses the existing API'))),

    validateField: scene.validateField || (() => false),
    validateRegionalSeries: scene.validateRegionalSeries || (() => false),
    validatePointSeries: scene.validatePointSeries || (() => false),

    describe() {
      return model;
    },
  };
}

export default createMarsOverviewAdapter;
