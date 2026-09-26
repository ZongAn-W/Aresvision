/** 图表回答的问题；选择前后的说明共用，数值与统计口径仍由各星球负责。 */
const descriptions = {
  seasonal: ['不同纬度在一年中怎样变化？用颜色比较各纬度的季节变化。', 'How does each latitude change over the year? Compare seasonal patterns by colour.'],
  globalTrend: ['全年哪些变量一起升降？比较全球平均值的变化趋势。', 'Which variables rise and fall together? Compare annual trends in global means.'],
  seasonalExtremes: ['一年中何时最高、何时最低？查看各纬带的极值和日期。', 'When are the annual highs and lows? Inspect extremes and dates for each latitude band.'],
  environment: ['环境变量怎样变化？比较风场、温度与辐射的年内变化。', 'How does the environment change? Compare annual patterns in wind, temperature, and radiation.'],
  polar: ['南北极有什么差异？比较极区的季节变化与统计结果。', 'How do the poles differ? Compare polar seasonal patterns and statistics.'],
  realtime: ['同一天内臭氧怎样变化？查看地方时与臭氧的关系。', 'How does ozone vary within a day? Examine its relationship with local time.'],
  diurnal: ['查看一天内的变化。日平均数据无法支持这项分析。', 'Explore variation within a day. Daily means cannot support this analysis.'],
  solarsens: ['太阳辐射与臭氧怎样一起变化？关系强弱不代表因果。', 'How do sunlight and ozone vary together? Association does not establish causation.'],
  correlation: ['哪些变量变化最接近？比较变量之间相关性的方向与强弱。', 'Which variables move together? Compare the direction and strength of correlations.'],
  coupling: ['温度与臭氧有什么联系？查看同期关系和滞后相关。', 'How are temperature and ozone related? Examine concurrent and lagged correlations.'],
  wave: ['哪些地方偏高或偏低？查看年平均空间距平和纬带差异。', 'Which locations are higher or lower? Inspect annual spatial anomalies and latitude-band differences.'],
};

const marsDescriptions = {
  seasonalExtremes: ['各纬带的全年振幅和峰值出现在何时？比较振幅与峰值 Ls。', 'Compare annual amplitudes and the Ls of peak values across latitude bands.'],
  coupling: ['温度与臭氧怎样随季节一起变化？比较两条全球平均年内曲线，不直接推断因果。', 'Compare the seasonal evolution of global mean temperature and ozone; co-variation does not establish causality.'],
  correlation: ['所选变量与臭氧有什么关系？比较散点回归、标准化年内变化和时滞相关。', 'Explore the selected variable and ozone through scatter regression, standardized seasonal evolution, and lag correlations.'],
  wave: ['哪些地方偏高或偏低？比较所选变量的年平均纬向距平与各纬带的 RMS、峰谷跨度。', 'Compare the selected variable’s annual zonal anomalies and latitude-band RMS and peak-to-peak span.'],
};

export function analysisDescription(key, isZh = true, planet = 'earth') {
  const copy = planet === 'mars' ? marsDescriptions[key] || descriptions[key] : descriptions[key];
  return copy?.[isZh ? 0 : 1] || '';
}

/** Earth 的年度图只显示真正参与该图计算的条件。 */
export function earthAnalysisControls(key) {
  return {
    variable: ['seasonal', 'seasonalExtremes', 'wave'].includes(key),
    scope: ['environment', 'solarsens', 'correlation', 'coupling'].includes(key),
    normalized: key === 'globalTrend',
  };
}
