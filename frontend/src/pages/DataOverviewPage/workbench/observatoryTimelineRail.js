/**
 * 观测刻度轨的纯数据层。
 *
 * 竖轨要表达三件事，全部由这里算出，组件只负责画：
 *  1. 当前年实际可播放的日期轴（不假设每一年都是 365 天）；
 *  2. 「年内偏离带」——把全球面积加权均值序列按年内均值归一化成一条横向幅度，
 *     让播放头滑过时能看出这一天处在全年的偏高段还是偏低段；
 *  3. 月份刻度与刻线位置。
 *
 * 本模块不导入 React、不取数、不做单位换算，因此可以直接单测。
 */

/** 取该日期是否落在给定年份。`2020-02-29` 这类真实日期由调用方保证格式。 */
export function isoYearOf(date) {
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? Number(date.slice(0, 4)) : null;
}

/**
 * 当前年实际存在的日期序列。
 *
 * 不生成 365 个格子：数据集可能缺日（v2 是 2020-01-01 ~ 2021-12-31 的完整逐日，
 * 但区域发布与未来年份都可能不是），因此以真实可播放日期为准。
 */
export function datesInYear(timeValues, year) {
  const rows = Array.isArray(timeValues) ? timeValues : [];
  if (!Number.isInteger(year)) return rows.filter((value) => isoYearOf(value) !== null);
  return rows.filter((value) => isoYearOf(value) === year);
}

export function daysInYear(year) {
  if (!Number.isInteger(year)) return 365;
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
}

/**
 * 把日期的年内进度转成 0–1。位置按「年内的第几天 / 全年天数」算，
 * 而不是按数组下标 —— 这样即使中间缺日，刻度与月份仍然对齐真实日期。
 *
 * 年份不是整数时直接返回 `null`：`year` 可能是 `null`（数据源还没解析完成），
 * 而 `null === null` 会让 `isoYearOf(null)` 的空值判断失效，顺手也保证
 * `date` 不是字符串时不会被 `slice`。
 */
export function yearProgress(date, year) {
  if (!Number.isInteger(year)) return null;
  if (typeof date !== 'string') return null;
  if (isoYearOf(date) !== year) return null;
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const start = Date.UTC(year, 0, 1);
  const current = Date.UTC(year, month - 1, day);
  const total = daysInYear(year);
  const index = Math.round((current - start) / 86_400_000);
  if (!Number.isFinite(index) || index < 0) return null;
  return Math.min(1, index / Math.max(1, total - 1));
}

/** 年内第几天，从 1 开始；用于读数区的 DOY。 */
export function dayOfYear(date, year) {
  const progress = yearProgress(date, year);
  if (progress === null) return null;
  return Math.round(progress * Math.max(1, daysInYear(year) - 1)) + 1;
}

/** 月份刻度：每个月 1 号的年内进度与本地化短名。 */
export function monthTicks(year, monthLabels = []) {
  if (!Number.isInteger(year)) return [];
  return Array.from({ length: 12 }, (_, monthIndex) => {
    const date = `${year}-${String(monthIndex + 1).padStart(2, '0')}-01`;
    return {
      month: monthIndex + 1,
      label: monthLabels[monthIndex] || String(monthIndex + 1),
      progress: yearProgress(date, year) ?? 0,
    };
  });
}

/**
 * 年内偏离带。
 *
 * 输入是完整数据集的区域均值序列（`regionalSeries`，全球面积加权均值逐日），
 * 这里只取当前年、按年内均值做中心化，再归一化成 0–1 的幅度：
 * 年内最低点 → 0，年内最高点 → 1。全平的年份返回 null，由调用方画一条直线。
 *
 * 参数与返回值都是纯数字，单位不参与计算，因此不改变任何数值语义。
 */
export function normalizeYearSeries({ dates, values, year }) {
  const dateRows = Array.isArray(dates) ? dates : [];
  const valueRows = Array.isArray(values) ? values : [];
  if (!dateRows.length || dateRows.length !== valueRows.length) return null;

  const rows = [];
  for (let index = 0; index < dateRows.length; index += 1) {
    const date = dateRows[index];
    if (isoYearOf(date) !== year) continue;
    // 只接受真正的数字：`Number(null)` 是 0、`Number('')` 也是 0，
    // 直接转型会把「缺失的一天」画成零值点。
    const raw = valueRows[index];
    const value = typeof raw === 'number' ? raw : null;
    if (!Number.isFinite(value)) continue;
    const progress = yearProgress(date, year);
    if (progress === null) continue;
    rows.push({ date, value, progress });
  }
  if (rows.length < 2) return null;

  const mean = rows.reduce((sum, row) => sum + row.value, 0) / rows.length;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    if (row.value < min) min = row.value;
    if (row.value > max) max = row.value;
  }
  const span = max - min;
  const points = rows.map((row) => ({
    date: row.date,
    progress: row.progress,
    value: row.value,
    // 偏离均值的方向与幅度：0 = 年内最低，1 = 年内最高。
    amplitude: span > 0 ? (row.value - min) / span : 0.5,
    aboveMean: row.value >= mean,
  }));

  return {
    points,
    mean,
    min,
    max,
    span,
    year,
  };
}

/**
 * 把归一化后的序列转成 SVG **折线**路径（不闭合、不回到基准线）。
 *
 * `baseline` 是刻度基准线的 x 坐标；幅度向基线右侧生长，因此「线鼓出来」=
 * 高于年内均值。只输出轮廓线而不填充：轨迹列没有底板，填充会在球体旁边糊出
 * 一片色块，而闭合多边形即使 `fill: none` 也会把基准线描出来、看起来像两列轨。
 */
export function buildBandPath({ series, baseline, maxOffset, height }) {
  if (!series?.points?.length || !Number.isFinite(baseline) || !Number.isFinite(maxOffset)) return '';
  if (maxOffset <= 0 || height <= 0) return '';
  const x = (amplitude) => baseline + amplitude * maxOffset;
  const y = (progress) => progress * height;
  return series.points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(point.amplitude).toFixed(2)} ${y(point.progress).toFixed(2)}`)
    .join(' ');
}

/** 读数区里的那一天在全球均值序列中的值（缺失时返回 null）。 */
export function seriesValueAt(series, date) {
  if (!series?.points?.length || !date) return null;
  const hit = series.points.find((point) => point.date === date);
  return hit ? hit.value : null;
}
