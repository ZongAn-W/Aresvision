/**
 * 点位/区域曲线的展示模型：日期轴、单位、当前值查找与 Plotly traces/layout。
 *
 * 曲线显示原始物理值，不做 Z-score、平滑或插值，也不与火星 Ls 混用。
 */

import { EARTH_VARIABLE_UNITS, isValidIsoDate } from './earthOverviewModel.js';

/** 当前展示日期对应的数值；找不到就是无数据，绝不用邻近日期替代。 */
export function currentSeriesValue(series, date) {
  if (!series || !Array.isArray(series.dates) || !Array.isArray(series.values)) return null;
  if (!isValidIsoDate(date)) return null;
  const index = series.dates.indexOf(date);
  if (index < 0) return null;
  const value = series.values[index];
  return Number.isFinite(value) ? value : null;
}

export function seriesUnits(variable, units) {
  return units || EARTH_VARIABLE_UNITS[variable] || '';
}

/**
 * 区域曲线 trace：全年展示，与点位共用同一物理单位。
 */
export function buildRegionalTrace(series, { variable, units, isLight }) {
  return {
    type: 'scatter',
    mode: 'lines',
    name: 'regional',
    x: series?.dates ?? [],
    y: series?.values ?? [],
    line: { color: isLight ? '#b45309' : '#fbbf24', width: 1.8 },
    hovertemplate: `%{x}<br>%{y:.3f} ${seriesUnits(variable, units)}<extra></extra>`,
    connectgaps: false,
  };
}

export function buildPointTrace(series, { variable, units, isLight }) {
  return {
    type: 'scatter',
    mode: 'lines',
    name: 'point',
    x: series?.dates ?? [],
    y: series?.values ?? [],
    line: { color: isLight ? '#0f766e' : '#5eead4', width: 1.8 },
    hovertemplate: `%{x}<br>%{y:.3f} ${seriesUnits(variable, units)}<extra></extra>`,
    connectgaps: false,
  };
}

/** 只跟随已展示的 field.date，不预先移动到尚未展示的请求日期。 */
export function buildDateMarker(displayedDate) {
  if (!isValidIsoDate(displayedDate)) return [];
  return [{
    type: 'line',
    x0: displayedDate,
    x1: displayedDate,
    yref: 'paper',
    y0: 0,
    y1: 1,
    line: { color: '#f97316', width: 1.4, dash: 'dot' },
  }];
}

export function buildSeriesLayout({ variable, units, displayedDate, isLight, height = 200 }) {
  return {
    height,
    margin: { l: 48, r: 12, t: 8, b: 34 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { size: 10, color: isLight ? '#334155' : '#cbd5f5' },
    xaxis: { type: 'date', showgrid: false, tickfont: { size: 9 } },
    yaxis: {
      title: { text: seriesUnits(variable, units), font: { size: 10 } },
      showgrid: true,
      gridcolor: isLight ? 'rgba(15,23,42,0.08)' : 'rgba(148,163,184,0.16)',
      zeroline: false,
    },
    shapes: buildDateMarker(displayedDate),
    showlegend: false,
  };
}

/** 按已展示日期在序列中取值，供标题区显示当前值。 */
export function describeCurrent({ pointSeries, regionalSeries, variable, units, displayedDate }) {
  return {
    variable,
    units: seriesUnits(variable, units),
    date: displayedDate,
    point: currentSeriesValue(pointSeries, displayedDate),
    regional: currentSeriesValue(regionalSeries, displayedDate),
  };
}
