import { convertOzone, ozoneLabel, convertTemp, tempLabel, convertWind, windLabel } from '../../../utils/units.js';

export function lsBounds(timeline = {}) {
  const min = Number.isFinite(timeline?.min) ? timeline.min : 0;
  const max = Number.isFinite(timeline?.max) && timeline.max >= min ? timeline.max : 360;
  const step = Number.isFinite(timeline?.step) && timeline.step > 0 ? timeline.step : 5;
  return { min, max, step };
}

export function lsTicks({ min, max }) {
  return [...new Set([min, ...[0, 90, 180, 270, 360].filter(ls => ls > min && ls < max), max])];
}

export function railUnit(variable, units = {}) {
  if (variable === 'o3col') return ozoneLabel(units.ozone);
  if (variable === 'Temperature') return tempLabel(units.temperature);
  if (variable === 'U_Wind' || variable === 'V_Wind') return windLabel(units.wind);
  return variable === 'Solar_Flux_DN' ? 'W/m²' : '';
}

export function railSeries(ls = [], values = [], variable, units = {}) {
  return ls.map((value, index) => {
    let physical = Number.isFinite(values[index]) ? values[index] : null;
    if (physical !== null) {
      if (variable === 'o3col') physical = convertOzone(physical, units.ozone);
      if (variable === 'Temperature') physical = convertTemp(physical, units.temperature);
      if (variable === 'U_Wind' || variable === 'V_Wind') physical = convertWind(physical, units.wind);
    }
    return { ls: value, value: physical };
  });
}

/**
 * 数值刻度范围。
 *
 * 调用方**每条轨只传自己那一条序列**：刻度各自独立，选点不会改变全球均值曲线的形状。
 * （参数仍接受多条序列并集，只为兼容既有调用；观测档不再把两条轨并成一把尺子。）
 */
export function railDomain(...series) {
  const values = series.flat().map(row => row.value).filter(Number.isFinite);
  return values.length ? [Math.min(...values), Math.max(...values)] : null;
}

// The vertical axis is actual Ls. Keep missing samples and year wraps disconnected.
export function railPath(rows, { min, max }, domain) {
  if (!domain || max <= min) return '';
  const [low, high] = domain;
  let previous = null;
  return rows.map(row => {
    if (!Number.isFinite(row.ls) || !Number.isFinite(row.value) || row.ls < min || row.ls > max) {
      previous = null;
      return '';
    }
    const command = previous !== null && row.ls > previous ? 'L' : 'M';
    const x = 22 + (high > low ? (row.value - low) / (high - low) : 0.5) * 54;
    const y = (row.ls - min) / (max - min) * 460;
    previous = row.ls;
    return `${command} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).filter(Boolean).join(' ');
}

export function nearestLsSample(rows, ls) {
  if (!Number.isFinite(ls)) return null;
  return rows.reduce((best, row) => Number.isFinite(row.ls)
    && (!best || Math.abs(row.ls - ls) < Math.abs(best.ls - ls)) ? row : best, null);
}
