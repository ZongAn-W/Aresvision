import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBandPath,
  datesInYear,
  dayOfYear,
  daysInYear,
  monthTicks,
  normalizeYearSeries,
  seriesValueAt,
  yearProgress,
} from './observatoryTimelineRail.js';

const isoRange = (start, end) => {
  const rows = [];
  const last = Date.parse(`${end}T00:00:00Z`);
  for (let t = Date.parse(`${start}T00:00:00Z`); t <= last; t += 86_400_000) {
    rows.push(new Date(t).toISOString().slice(0, 10));
  }
  return rows;
};

test('the rail plays only real dates of the selected year', () => {
  const axis = isoRange('2020-01-01', '2021-12-31');
  assert.equal(axis.length, 731);
  const y2020 = datesInYear(axis, 2020);
  const y2021 = datesInYear(axis, 2021);
  assert.equal(y2020.length, 366, '2020 is a leap year');
  assert.equal(y2021.length, 365);
  assert.equal(y2020[0], '2020-01-01');
  assert.equal(y2020[y2020.length - 1], '2020-12-31');
  assert.equal(daysInYear(2020), 366);
  assert.equal(daysInYear(2021), 365);
});

test('position uses the real calendar day, not the array index', () => {
  // 3 月 1 日在闰年是第 61 天，在平年是第 60 天。
  assert.equal(dayOfYear('2020-03-01', 2020), 61);
  assert.equal(dayOfYear('2021-03-01', 2021), 60);
  assert.equal(dayOfYear('2020-01-01', 2020), 1);
  assert.equal(dayOfYear('2020-12-31', 2020), 366);
  assert.equal(dayOfYear('2021-12-31', 2021), 365);
  // 年份不匹配时不给位置，避免把别的年份的日期画进这一年的轨道。
  assert.equal(yearProgress('2021-06-01', 2020), null);
  assert.equal(dayOfYear('not-a-date', 2020), null);
});

test('positions stay inside 0..1 across a leap year and a common year', () => {
  for (const year of [2020, 2021]) {
    for (const date of datesInYear(isoRange(`${year}-01-01`, `${year}-12-31`), year)) {
      const progress = yearProgress(date, year);
      assert.ok(progress >= 0 && progress <= 1, `${date} → ${progress}`);
    }
  }
  assert.equal(yearProgress('2020-01-01', 2020), 0);
  assert.equal(yearProgress('2020-12-31', 2020), 1);
});

test('twelve month ticks land on the first of each month in order', () => {
  const ticks = monthTicks(2020, ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']);
  assert.equal(ticks.length, 12);
  assert.equal(ticks[0].progress, 0);
  assert.deepEqual(ticks.map((tick) => tick.month), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const progresses = ticks.map((tick) => tick.progress);
  assert.deepEqual([...progresses].sort((a, b) => a - b), progresses, 'ticks must be monotonic');
  assert.equal(ticks[11].label, 'D');
  // 12 月 1 日大致落在 11/12 处；不跨年比较绝对值，因为闰年与平年的分母不同。
  assert.ok(Math.abs(ticks[11].progress - 11 / 12) < 0.005, String(ticks[11].progress));
  assert.ok(Math.abs(ticks[5].progress - 5 / 12) < 0.005, String(ticks[5].progress));
  // 闰年里 3 月 1 日是按「第 61 天 / 366」算的，平年按「第 60 天 / 365」。
  assert.ok(Math.abs(monthTicks(2020)[2].progress - 60 / 365) < 1e-9);
  assert.ok(Math.abs(monthTicks(2021)[2].progress - 59 / 364) < 1e-9);
});

test('the deviation band is centred on the annual mean and normalised to 0..1', () => {
  const dates = isoRange('2020-01-01', '2020-12-31');
  const values = dates.map((_, index) => 100 + index / 10);
  const series = normalizeYearSeries({ dates, values, year: 2020 });
  assert.ok(series);
  assert.equal(series.points.length, 366);
  assert.equal(series.min, 100);
  assert.equal(series.max, 100 + 365 / 10);
  assert.equal(series.points[0].amplitude, 0);
  assert.equal(series.points[series.points.length - 1].amplitude, 1);
  assert.equal(series.points[0].aboveMean, false);
  assert.equal(series.points[series.points.length - 1].aboveMean, true);
  // 年内均值落在中点附近（线性序列）。
  assert.ok(Math.abs(series.mean - (series.min + series.max) / 2) < 1e-6);
});

test('only the selected year is used, and missing days are tolerated', () => {
  const dates = isoRange('2020-01-01', '2021-12-31');
  const values = dates.map((date) => (date.startsWith('2020') ? 10 : 20));
  const y2020 = normalizeYearSeries({ dates, values, year: 2020 });
  assert.ok(y2020);
  assert.equal(y2020.points.length, 366);
  assert.equal(y2020.min, 10);
  assert.equal(y2020.max, 10);
  // 全平的年份没有形状：span 为 0，幅度统一取中线。
  assert.equal(y2020.span, 0);
  assert.ok(y2020.points.every((point) => point.amplitude === 0.5));

  // 少于两个可用点、长度不匹配时都不给带子。
  assert.equal(normalizeYearSeries({ dates: ['2020-01-01'], values: [1], year: 2020 }), null);
  assert.equal(normalizeYearSeries({ dates: ['2020-01-01'], values: [1, 2], year: 2020 }), null);
  assert.equal(normalizeYearSeries({ dates: [], values: [], year: 2020 }), null);
  // null / undefined / 字符串都不算数值：`Number(null)` 是 0，直接转型会把缺失日画成零值。
  assert.equal(normalizeYearSeries({ dates: ['2020-01-01', '2020-01-02'], values: [1, null], year: 2020 }), null);
  assert.equal(normalizeYearSeries({ dates: ['2020-01-01', '2020-01-02'], values: [1, undefined], year: 2020 }), null);
  assert.equal(normalizeYearSeries({ dates: ['2020-01-01', '2020-01-02'], values: [1, '2'], year: 2020 }), null);
  // 一天缺失、其余可用时只丢弃那一天，且缺失值不参与极值。
  const withGap = normalizeYearSeries({
    dates: ['2020-01-01', '2020-01-02', '2020-01-03'],
    values: [5, null, 15],
    year: 2020,
  });
  assert.ok(withGap);
  assert.equal(withGap.points.length, 2);
  assert.equal(withGap.min, 5);
  assert.equal(withGap.max, 15);
});

test('the band path is an open outline that never closes back onto the baseline', () => {
  const dates = isoRange('2020-01-01', '2020-12-31');
  const values = dates.map((_, index) => Math.sin(index / 20) * 50 + 200);
  const series = normalizeYearSeries({ dates, values, year: 2020 });
  const path = buildBandPath({ series, baseline: 40, maxOffset: 24, height: 600 });
  // 一个点一段：M + (n-1) 个 L，没有 Z，也不会回到基线起点。
  assert.equal((path.match(/[ML]/g) || []).length, series.points.length);
  assert.equal(path.includes('Z'), false, 'an open outline must not close');
  const first = series.points[0];
  const expectedFirst = `M ${(40 + first.amplitude * 24).toFixed(2)} ${(first.progress * 600).toFixed(2)}`;
  assert.ok(path.startsWith(expectedFirst), path.slice(0, 40));
  // 幅度按比例映射到 0..maxOffset 的横向位移。
  const minPoint = series.points.reduce((a, b) => (a.amplitude <= b.amplitude ? a : b));
  const maxPoint = series.points.reduce((a, b) => (a.amplitude >= b.amplitude ? a : b));
  assert.ok(path.includes(`L 40.00 ${(minPoint.progress * 600).toFixed(2)}`));
  assert.ok(path.includes(`L ${(40 + 24).toFixed(2)} ${(maxPoint.progress * 600).toFixed(2)}`));
  // 退化输入不产生半截路径。
  assert.equal(buildBandPath({ series, baseline: 40, maxOffset: 0, height: 600 }), '');
  assert.equal(buildBandPath({ series, baseline: 40, maxOffset: 24, height: 0 }), '');
  assert.equal(buildBandPath({ series: null, baseline: 40, maxOffset: 24, height: 600 }), '');
});

test('a null year never slices a null date', () => {
  // 数据源还没解析完时 `year` 与 `requestedDate` 都是 null；这里不能抛，只能返回 null。
  assert.equal(yearProgress(null, null), null);
  assert.equal(yearProgress(undefined, undefined), null);
  assert.equal(yearProgress('2020-01-01', null), null);
  assert.equal(yearProgress('2020-01-01', undefined), null);
  assert.equal(yearProgress('2020-01-01', '2020'), null, 'a string year is not an integer year');
  assert.equal(dayOfYear(null, null), null);
  assert.equal(datesInYear(null, null).length, 0);
  assert.equal(monthTicks(null).length, 0);
  assert.equal(monthTicks(2020).length, 12);
  assert.equal(yearProgress('2020-01-01', 2020), 0);
});

test('the readout can look up the displayed date without inventing a value', () => {
  const dates = isoRange('2020-01-01', '2020-12-31');
  const values = dates.map((_, index) => index + 1);
  const series = normalizeYearSeries({ dates, values, year: 2020 });
  assert.equal(seriesValueAt(series, '2020-01-01'), 1);
  assert.equal(seriesValueAt(series, '2020-12-31'), 366);
  assert.equal(seriesValueAt(series, '2021-01-01'), null);
  assert.equal(seriesValueAt(series, null), null);
  assert.equal(seriesValueAt(null, '2020-01-01'), null);
});
