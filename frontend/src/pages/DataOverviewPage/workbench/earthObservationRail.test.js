import test from 'node:test';
import assert from 'node:assert/strict';
import { earthRailSeries, earthRailDomain, earthRailPath, nearestEarthRailDate } from './earthObservationRail.js';

test('Earth rail keeps ISO dates, leap day and missing values in the selected year', () => {
  const rows = earthRailSeries({ dates: ['2019-12-31', '2020-02-28', '2020-02-29', '2020-03-01'], values: [999, 250, null, 260] }, 2020);
  assert.deepEqual(rows.map(({ date, value }) => ({ date, value })), [
    { date: '2020-02-28', value: 250 }, { date: '2020-02-29', value: null }, { date: '2020-03-01', value: 260 },
  ]);
  assert.equal(rows[1].progress, 59 / 365);
  assert.deepEqual(earthRailSeries(null, 2020), []);
});

test('each rail scales its own value bounds while both keep the original units and date axis', () => {
  const dates = ['2021-01-01', '2021-01-02', '2021-01-03'];
  const global = earthRailSeries({ dates, values: [270, 280, 290] }, 2021);
  const point = earthRailSeries({ dates, values: [250, 300, 330] }, 2021);

  // 刻度只跟本轨有关：全球均值轨永远用 270–290，选点不会把它压扁。
  assert.deepEqual(earthRailDomain(global), [270, 290]);
  assert.deepEqual(earthRailDomain(point), [250, 330]);
  // 两条轨各归各的：同样的“首尾极值、中间居中”形状，中间点的横向位置由本轨自己的数列决定。
  assert.equal(earthRailPath(global, earthRailDomain(global)), 'M 22.00 0.00 L 49.00 1.26 L 76.00 2.53');
  assert.equal(earthRailPath(point, earthRailDomain(point)), 'M 22.00 0.00 L 55.75 1.26 L 76.00 2.53');
  assert.deepEqual(earthRailDomain([], []), null);

  // 垂直日期轴严格共用：同一天在两条轨上落在同一 y 坐标。
  const ys = (path) => [...path.matchAll(/[ML] [\d.]+ ([\d.]+)/g)].map((match) => match[2]);
  assert.deepEqual(ys(earthRailPath(global, earthRailDomain(global))), ys(earthRailPath(point, earthRailDomain(point))));
});

test('date curves break at null samples and absent days instead of interpolating gaps', () => {
  const rows = earthRailSeries({ dates: ['2020-01-01', '2020-01-02', '2020-01-03', '2020-01-04', '2020-01-06'], values: [1, 2, null, 3, 4] }, 2020);
  assert.deepEqual(earthRailPath(rows, [1, 4]).match(/[ML]/g), ['M', 'L', 'M', 'M']);
  assert.equal(earthRailPath(earthRailSeries({ dates: ['2020-01-01', '2020-12-31'], values: [5, 5] }, 2020), [5, 5]), 'M 49.00 0.00 M 49.00 460.00');
});

test('slider seeks real available dates by calendar day, including leap day and dataset gaps', () => {
  const dates = ['2020-02-28', '2020-02-29', '2020-03-03'];
  assert.equal(nearestEarthRailDate(dates, 60, 2020), '2020-02-29');
  assert.equal(nearestEarthRailDate(dates, 61, 2020), '2020-02-29');
  assert.equal(nearestEarthRailDate(dates, 62, 2020), '2020-03-03');
  assert.equal(nearestEarthRailDate(dates, 1, 2020), '2020-02-28');
  assert.equal(nearestEarthRailDate(dates, 366, 2020), '2020-03-03');
  assert.equal(nearestEarthRailDate([], 60, 2020), null);
});
