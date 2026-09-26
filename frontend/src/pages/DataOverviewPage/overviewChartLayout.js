import C from '../../constants/colors.js';

export const MODE_CARD_KEYS = {
  temporal: ['seasonal', 'globalTrend', 'seasonalExtremes', 'environment', 'polar', 'realtime'],
  drivers: ['solarsens', 'correlation', 'coupling'],
  dynamics: ['wave'],
};

export const MODE_DEFS = [
  {
    id: 'temporal',
    icon: '1',
    color: C.mars,
    title: { zh: '变化规律', en: 'Change over time' },
    desc: {
      zh: '先看这一火星年的季节结构、全球变化、关键环境因子和极区特征。',
      en: 'Start with seasonal structure, annual global change, key environmental factors, and polar behavior.',
    },
  },
  {
    id: 'drivers',
    icon: '2',
    color: C.green,
    title: { zh: '变量关系', en: 'Variable relations' },
    desc: {
      zh: '进一步查看太阳辐射、变量相关和温度-O3耦合关系；这些图用于探索关系，不直接证明因果。',
      en: 'Explore solar flux, variable correlation, and temperature-O3 coupling. These charts show associations, not direct causality.',
    },
  },
  {
    id: 'dynamics',
    icon: '3',
    color: '#d9a441',
    title: { zh: '空间诊断', en: 'Spatial diagnostics' },
    desc: {
      zh: '查看年平均空间距平、纬度带 RMS 和峰谷跨度，用于研究空间波动结构。',
      en: 'Inspect annual spatial anomalies, latitude-band RMS, and peak-to-peak span for wave-structure analysis.',
    },
  },
];

export const CARD_TITLES = {
  realtime: { zh: '昼夜变化', en: 'Diurnal O3' },
  seasonal: { zh: '季节变化', en: 'Seasonal structure' },
  seasonalExtremes: { zh: '季节极值', en: 'Seasonal extremes' },
  globalTrend: { zh: '年内全球变化', en: 'Annual global change' },
  environment: { zh: '环境因子', en: 'Environmental factors' },
  solarsens: { zh: '太阳辐射-O3关系', en: 'Solar flux-O3 relationship' },
  wave: { zh: '波动结构与诊断', en: 'Wave structure and diagnostics' },
  polar: { zh: '极区动力', en: 'Polar dynamics' },
  coupling: { zh: '温度-O3耦合', en: 'Temperature-O3 coupling' },
  distribution: { zh: '点位分布', en: 'Distribution' },
  correlation: { zh: '变量相关性', en: 'Variable correlation' },
};

export function getModeCardKeys(modeId) {
  return MODE_CARD_KEYS[modeId] || [];
}

export function getCardTitle(cardKey, isZh = true) {
  const title = CARD_TITLES[cardKey];
  if (!title) return cardKey;
  return isZh ? title.zh : title.en;
}
