import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDateMarker,
  buildPointTrace,
  buildRegionalTrace,
  buildSeriesLayout,
  currentSeriesValue,
  describeCurrent,
  seriesUnits,
} from './earthSeriesModel.js';

// A sequence crossing the 2020 leap day, so index math cannot assume 365 days.
const DATES = ['2020-02-28', '2020-02-29', '2020-03-01'];
const VALUES = [12.5, 13.25, 11.75];

test('currentSeriesValue looks up the displayed date exactly', () => {
  const series = { dates: DATES, values: VALUES };
  assert.equal(currentSeriesValue(series, '2020-02-29'), 13.25);
  assert.equal(currentSeriesValue(series, '2020-03-01'), 11.75);
  // A date outside the series is "no data", never a neighbouring value.
  assert.equal(currentSeriesValue(series, '2020-03-02'), null);
  assert.equal(currentSeriesValue(series, '2021-02-28'), null);
  assert.equal(currentSeriesValue(series, 'bogus'), null);
  assert.equal(currentSeriesValue(null, '2020-02-29'), null);
  // Non-finite stored values are reported as missing rather than plotted.
  assert.equal(currentSeriesValue({ dates: DATES, values: [1, null, 3] }, '2020-02-29'), null);
});

test('units come from the payload and fall back to the fixed original units', () => {
  assert.equal(seriesUnits('TO3', 'DU'), 'DU');
  assert.equal(seriesUnits('U10M', undefined), 'm s-1');
  assert.equal(seriesUnits('T2M', undefined), 'K');
  assert.equal(seriesUnits('SWGDN', undefined), 'W m-2');
  assert.equal(seriesUnits('unknown', undefined), '');
});

test('regional trace plots every day in original units without smoothing', () => {
  const trace = buildRegionalTrace({ dates: DATES, values: VALUES }, {
    variable: 'TO3', units: 'DU', isLight: false,
  });
  assert.equal(trace.type, 'scatter');
  assert.equal(trace.mode, 'lines');
  assert.deepEqual(trace.x, DATES);
  assert.deepEqual(trace.y, VALUES);
  assert.equal(trace.connectgaps, false);
  assert.ok(trace.hovertemplate.includes('DU'));
});

test('point trace carries the point series and its units', () => {
  const trace = buildPointTrace({ dates: DATES, values: VALUES }, {
    variable: 'T2M', units: 'K', isLight: true,
  });
  assert.deepEqual(trace.x, DATES);
  assert.deepEqual(trace.y, VALUES);
  assert.ok(trace.hovertemplate.includes('K'));
  assert.equal(trace.connectgaps, false);
});

test('the date marker follows the displayed field date only', () => {
  const marker = buildDateMarker('2020-02-29');
  assert.equal(marker.length, 1);
  assert.equal(marker[0].x0, '2020-02-29');
  assert.equal(marker[0].x1, '2020-02-29');
  // An unset or invalid displayed date draws no marker at all.
  assert.deepEqual(buildDateMarker(null), []);
  assert.deepEqual(buildDateMarker('2020-02-30'), []);
});

test('layout keeps the physical unit on the y axis and marks the displayed day', () => {
  const layout = buildSeriesLayout({
    variable: 'SWGDN', units: 'W m-2', displayedDate: '2020-03-01', isLight: false,
  });
  assert.equal(layout.yaxis.title.text, 'W m-2');
  assert.equal(layout.shapes.length, 1);
  assert.equal(layout.shapes[0].x0, '2020-03-01');
  // A new field date moves the marker to that date, not to a requested one.
  const moved = buildSeriesLayout({
    variable: 'SWGDN', units: 'W m-2', displayedDate: '2020-02-28', isLight: false,
  });
  assert.equal(moved.shapes[0].x0, '2020-02-28');
});

test('describeCurrent separates the point value from the coverage mean', () => {
  const point = { dates: DATES, values: VALUES };
  const regional = { dates: DATES, values: [100, 110, 120] };
  const described = describeCurrent({
    pointSeries: point, regionalSeries: regional, variable: 'TO3', units: 'DU',
    displayedDate: '2020-02-29',
  });
  assert.deepEqual(described, {
    variable: 'TO3', units: 'DU', date: '2020-02-29', point: 13.25, regional: 110,
  });
  // A stale identity (date not in the series) reports no current value.
  const stale = describeCurrent({
    pointSeries: point, regionalSeries: regional, variable: 'TO3', units: 'DU',
    displayedDate: '2021-12-31',
  });
  assert.equal(stale.point, null);
  assert.equal(stale.regional, null);
});
