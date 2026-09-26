import { dayOfYear, yearProgress } from './observatoryTimelineRail.js';

const TRACK_HEIGHT = 460;
const BASELINE = 22;
const MAX_OFFSET = 54;

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Convert the Earth series into calendar-positioned rows without changing units. */
export function earthRailSeries(series, year) {
  const dates = Array.isArray(series?.dates) ? series.dates : [];
  const values = Array.isArray(series?.values) ? series.values : [];
  return dates.flatMap((date, index) => {
    if (typeof date !== 'string' || Number(date.slice(0, 4)) !== year) return [];
    return [{
      date,
      value: finite(values[index]) ? values[index] : null,
      progress: yearProgress(date, year),
      day: dayOfYear(date, year),
    }];
  }).filter((row) => row.progress !== null);
}

/**
 * 数值刻度范围。
 *
 * 调用方**每条轨只传自己那一条序列**：刻度各自独立，选点不会改变全球均值曲线的形状。
 * （参数仍接受多条序列并集，只为兼容既有调用；观测档不再把两条轨并成一把尺子。）
 */
export function earthRailDomain(...series) {
  const values = series.flat().map((row) => row?.value).filter(finite);
  return values.length ? [Math.min(...values), Math.max(...values)] : null;
}

/** SVG path for the narrow Mars-style curve; missing values and calendar gaps stay disconnected. */
export function earthRailPath(rows, domain, { baseline = BASELINE, maxOffset = MAX_OFFSET, height = TRACK_HEIGHT } = {}) {
  if (!Array.isArray(rows) || !domain || domain.length < 2 || height <= 0 || maxOffset <= 0) return '';
  const [low, high] = domain;
  let previous = null;
  return rows.map((row) => {
    if (!finite(row?.value) || !finite(row?.progress)) {
      previous = null;
      return '';
    }
    const contiguous = previous !== null && row.day === previous + 1;
    const x = baseline + (high > low ? ((row.value - low) / (high - low)) : 0.5) * maxOffset;
    const y = row.progress * height;
    previous = row.day;
    return `${contiguous ? 'L' : 'M'} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).filter(Boolean).join(' ');
}

/** Find the available ISO date closest to a requested calendar day (ties prefer the later date). */
export function nearestEarthRailDate(dates, requestedDay, year) {
  if (!Array.isArray(dates) || !dates.length || !Number.isFinite(requestedDay)) return null;
  return dates.reduce((best, date) => {
    const day = dayOfYear(date, year);
    if (!Number.isFinite(day)) return best;
    if (!best) return { date, day };
    const distance = Math.abs(day - requestedDay);
    const bestDistance = Math.abs(best.day - requestedDay);
    return distance <= bestDistance ? { date, day } : best;
  }, null)?.date || null;
}

export { TRACK_HEIGHT };
