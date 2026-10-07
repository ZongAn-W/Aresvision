import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EARTH_3HOURLY_DATASET_ID, EARTH_DATASET_ID, canRequestEarthData, earthTimeAtIndex,
  earthTimeIndex, earthTimeValues, formatEarthTime, isValidFieldPayload,
  isValidPointPayload, isValidRegionalPayload, isValidUtcTimestamp, nextPlaybackDate,
} from './earthOverviewModel.js';
import { createEarthOverviewAdapter } from '../workbench/earthOverviewAdapter.js';
import { dateInSelectedYear, nextPlaybackValue, timeValueKey, timeValues, yearOfIsoDate } from '../workbench/OverviewAdapter.js';
import { earthRailDomain, earthRailPath, earthRailSeries, nearestEarthRailDate } from '../workbench/earthObservationRail.js';
import { createEarthRequestCoordinator } from './earthRequestCoordinator.js';
import { buildDateMarker, currentSeriesValue } from './earthSeriesModel.js';

const fingerprint = 'a'.repeat(64);
const temporal = { frequency_hours: 3, step_unit: 'hour', step: 3, time_zone: 'UTC' };
const start = '2020-02-28T22:30:00Z';
const end = '2020-02-29T04:30:00Z';
const timestamps = earthTimeValues(start, end, 3);

function field() {
  return {
    planet: 'earth', dataset_id: EARTH_3HOURLY_DATASET_ID, dataset_fingerprint: fingerprint,
    variable: 'TO3', units: 'DU', date: start, timestamp: start, ...temporal,
    lat: Array.from({ length: 60 }, (_, index) => -88.5 + index * 3),
    lon: Array.from({ length: 120 }, (_, index) => -178.5 + index * 3),
    field: Array.from({ length: 60 }, () => Array(120).fill(280)),
    dimension_order: ['lat', 'lon'], source_grid_shape: [240, 480], render_grid_shape: [60, 120],
    render_method: 'spherical_cell_area_mean_4x4',
    coverage: { latitude_range: [-90, 90], longitude_range: [-180, 180], wrap_longitude: true },
    color_range: { min: 240, max: 320 }, statistics: { regional_mean: 280 },
  };
}

function descriptor() {
  return { dataset_id: EARTH_3HOURLY_DATASET_ID, dataset_fingerprint: fingerprint,
    availability: 'available', capabilities: { web_overview: true }, ...temporal,
    time: { start, end, kind: 'datetime', time_zone: 'UTC' },
    channel_order: ['TO3', 'U10M', 'V10M', 'T2M', 'SWGDN'],
    grid: { latitude_values: Array.from({ length: 240 }, (_, i) => -89.625 + i * .75),
      longitude_values: Array.from({ length: 480 }, (_, i) => -179.625 + i * .75),
      latitude_range: [-90, 90], longitude_range: [-180, 180], wrap_longitude: true },
  };
}

test('UTC axis preserves leap midnight, three-hour steps, and rejects naive or off-grid timestamps', () => {
  assert.deepEqual(timestamps, [start, '2020-02-29T01:30:00Z', end]);
  assert.equal(earthTimeAtIndex(start, 1, 3), timestamps[1]);
  assert.equal(earthTimeIndex(start, end, timestamps[1], 3), 1);
  assert.equal(earthTimeIndex(start, end, '2020-02-29T02:30:00Z', 3), null);
  assert.equal(earthTimeIndex(start, end, '2020-02-29', 3), null);
  assert.equal(isValidUtcTimestamp('2021-02-29T01:30:00Z'), false);
  assert.equal(isValidUtcTimestamp('2020-02-29T01:30:00'), false);
  assert.equal(isValidUtcTimestamp('2020-02-29T01:30:00+08:00'), false);
  assert.equal(formatEarthTime(timestamps[1]), '2020-02-29 01:30 UTC');
  assert.equal(formatEarthTime('2020-02-29'), '2020-02-29');
});

test('three-hour playback waits for the actual field and stops at the last frame', () => {
  const args = { start, end, displayedDate: start, requestedDate: start, ready: true,
    playing: true, frequencyHours: 3 };
  assert.equal(nextPlaybackDate(args), timestamps[1]);
  assert.equal(nextPlaybackDate({ ...args, requestedDate: end }), null);
  assert.equal(nextPlaybackDate({ ...args, displayedDate: end, requestedDate: end }), null);
  const time = { kind: 'iso-datetime', values: timestamps, step: 3, stepUnit: 'hour' };
  assert.deepEqual(timeValues(time), timestamps);
  assert.equal(timeValueKey(time, '2020-02-29'), null);
  assert.equal(nextPlaybackValue({ time, requestedValue: start, displayedValue: start, playing: true, ready: true }), timestamps[1]);
  assert.equal(yearOfIsoDate(start), 2020);
  assert.equal(dateInSelectedYear('2020-02-29T01:30:00Z', 2021), '2021-02-28T01:30:00Z');
});

test('descriptor gates unavailable releases and a malformed datetime interval', () => {
  assert.equal(canRequestEarthData(descriptor()), true);
  assert.equal(canRequestEarthData({ ...descriptor(), availability: 'missing' }), false);
  assert.equal(canRequestEarthData({ ...descriptor(), frequency_hours: 24 }), false);
  assert.equal(canRequestEarthData({ ...descriptor(), time: { start, end: '2020-02-29T02:30:00Z' } }), false);
});

test('display map validates its native identity, 4x4 area means, UTC time and masks', () => {
  const expected = { datasetId: EARTH_3HOURLY_DATASET_ID, fingerprint, variable: 'TO3', date: start };
  const payload = field();
  payload.field[0][0] = null;
  payload.field[0][1] = 0;
  assert.equal(isValidFieldPayload(payload, expected), true);
  assert.equal(isValidFieldPayload({ ...payload, timestamp: end }, expected), false);
  assert.equal(isValidFieldPayload({ ...payload, render_method: 'stride_4' }, expected), false);
  assert.equal(isValidFieldPayload({ ...payload, source_grid_shape: [36, 72] }, expected), false);
  assert.equal(isValidFieldPayload({ ...payload, dataset_fingerprint: 'b'.repeat(64) }, expected), false);
  payload.field[0][0] = Infinity;
  assert.equal(isValidFieldPayload(payload, expected), false);
});

test('point and regional series preserve null masks with a continuous UTC alias axis', () => {
  const expected = { datasetId: EARTH_3HOURLY_DATASET_ID, fingerprint, variable: 'TO3' };
  const series = { planet: 'earth', dataset_id: EARTH_3HOURLY_DATASET_ID, dataset_fingerprint: fingerprint,
    variable: 'TO3', units: 'DU', ...temporal, dates: timestamps, timestamps, values: [280, null, 0],
    aggregation: 'spherical_cell_area_mean', selection: 'nearest_grid_point',
    grid_point: { lat: .375, lon: .375, lat_index: 120, lon_index: 240 } };
  assert.equal(isValidRegionalPayload(series, expected), true);
  assert.equal(isValidPointPayload(series, expected), true);
  assert.equal(currentSeriesValue(series, timestamps[1]), null);
  assert.equal(currentSeriesValue(series, end), 0);
  assert.equal(buildDateMarker(end)[0].x0, end);
  assert.equal(isValidRegionalPayload({ ...series, dates: [start, end], timestamps: [start, end], values: [1, 2] }, expected), false);
  assert.equal(isValidPointPayload({ ...series, timestamps: [end] }, expected), false);
  assert.equal(isValidPointPayload({ ...series, grid_point: { lat: 1.5, lon: 1.5, lat_index: 30, lon_index: 60 } }, expected), false);
});

test('rail keeps eight intraday samples distinct and breaks missing or skipped frames', () => {
  const dates = earthTimeValues('2020-01-01T01:30:00Z', '2020-01-01T22:30:00Z', 3);
  const rows = earthRailSeries({ timestamps: dates, values: [1, 2, null, 4, 5, 6, 7, 8] }, 2020);
  assert.equal(rows.length, 8);
  assert.ok(Math.abs(rows[1].progress - rows[0].progress - 3 / (366 * 24)) < 1e-12);
  assert.deepEqual(earthRailDomain(rows), [1, 8]);
  assert.deepEqual(earthRailPath(rows, [1, 8]).match(/[ML]/g), ['M', 'L', 'M', 'L', 'L', 'L', 'L']);
  assert.equal(nearestEarthRailDate(dates, 1 + 4.5 / 24, 2020), dates[1]);
});

test('source switching cancels all old Earth channels and rejects late responses', () => {
  const coordinator = createEarthRequestCoordinator();
  const tokens = ['field', 'point', 'regional', 'annual'].map((name) => coordinator.start(name, `${EARTH_DATASET_ID}|${fingerprint}`));
  coordinator.invalidateAll();
  for (const token of tokens) {
    assert.equal(token.signal.aborted, true);
    assert.equal(coordinator.settle(token, token.contextKey), false);
  }
  const next = coordinator.start('field', `${EARTH_3HOURLY_DATASET_ID}|${fingerprint}|${start}`);
  assert.equal(coordinator.settle(next, next.contextKey), true);
});

test('adapter resolves three-hour UTC geometry and requests timestamps, not daily dates or Mars fields', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(new URL(url, 'http://localhost'));
    const payload = String(url).includes('/context')
      ? { time: { start, end }, capabilities: { diurnal: false }, geometry: {} }
      : String(url).includes('/overview/field') ? field() : descriptor();
    return { ok: true, json: async () => payload };
  };
  try {
    const adapter = createEarthOverviewAdapter({ datasetId: EARTH_3HOURLY_DATASET_ID });
    const resolved = await adapter.resolve();
    assert.equal(resolved.time.kind, 'iso-datetime');
    assert.deepEqual(resolved.time.values, timestamps);
    assert.deepEqual(resolved.geometry.shape, [60, 120]);
    assert.deepEqual(adapter.cellForPoint(resolved.geometry, { lat: .8, lon: 1.1 }), { lat: .8, lon: 1.1 });
    const payload = await adapter.loadField({ value: start, variable: 'TO3' });
    assert.equal(calls.at(-1).searchParams.get('timestamp'), start);
    assert.equal(calls.at(-1).searchParams.has('date'), false);
    assert.equal(calls.at(-1).searchParams.get('expected_fingerprint'), fingerprint);
    assert.equal(adapter.validateField(payload, { sourceFingerprint: fingerprint, variable: 'TO3', value: start }), true);
    assert.equal(adapter.normalizeField(payload).sourceGridShape.join(','), '240,480');
    assert.equal(calls.some((url) => url.searchParams.has('ls') || url.searchParams.has('my')), false);
    adapter.invalidateResearch();
  } finally {
    globalThis.fetch = original;
  }
});
