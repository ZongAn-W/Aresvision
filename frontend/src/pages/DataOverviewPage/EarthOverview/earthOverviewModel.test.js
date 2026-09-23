import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canRequestEarthData,
  dateAtIndex,
  dateIndexWithin,
  earthColormap,
  fieldIdentity,
  initialEarthSelection,
  isValidFieldPayload,
  isValidPointPayload,
  isValidRegionalPayload,
  isoDayNumber,
  nextPlaybackDate,
  pointIdentity,
  regionalIdentity,
  shiftDate,
} from './earthOverviewModel.js';

const FINGERPRINT = 'a'.repeat(64);

function fieldPayload(overrides = {}) {
  return {
    dataset_id: 'earth_merra2_daily_v1',
    dataset_version: 'v1',
    dataset_fingerprint: FINGERPRINT,
    planet: 'earth',
    variable: 'TO3',
    units: 'DU',
    date: '2020-02-29',
    calendar: 'proleptic_gregorian',
    lat: [-4, 0, 4],
    lon: [-5, 0, 5],
    dimension_order: ['lat', 'lon'],
    field: [[1, 2, 3], [4, 5, 6], [7, 8, 9]],
    coverage: {
      latitude_range: [-60, 60],
      longitude_range: [-120, 120],
      wrap_longitude: false,
    },
    color_range: { min: 1, max: 9, scope: 'dataset', centered_on_zero: false },
    statistics: { min: 1, max: 9, regional_mean: 5, valid_count: 9 },
    ...overrides,
  };
}

const fieldExpectation = {
  datasetId: 'earth_merra2_daily_v1',
  fingerprint: FINGERPRINT,
  variable: 'TO3',
  date: '2020-02-29',
};

test('ISO date parsing is strict and timezone independent', () => {
  const day0 = isoDayNumber('2020-01-01');
  assert.equal(day0, 18262);
  assert.equal(isoDayNumber('2020-02-29'), day0 + 59);
  // 2020 is a leap year, so 2021-01-01 is 366 days after the start.
  assert.equal(isoDayNumber('2021-01-01'), day0 + 366);
  assert.equal(isoDayNumber('2021-02-28'), day0 + 366 + 58);
  assert.equal(isoDayNumber('2021-12-31'), day0 + 730);

  for (const bad of ['2020-1-1', '2020/01/01', '2020-01-01T00:00:00Z', '20200229', '', '27', null, 27]) {
    assert.throws(() => isoDayNumber(bad), /Invalid ISO date/, String(bad));
  }
});

test('leap day arithmetic stays correct across the boundary', () => {
  assert.equal(dateAtIndex('2020-01-01', 0), '2020-01-01');
  assert.equal(dateAtIndex('2020-01-01', 59), '2020-02-29');
  assert.equal(dateAtIndex('2020-01-01', 60), '2020-03-01');
  assert.equal(shiftDate('2020-02-28', 1), '2020-02-29');
  assert.equal(shiftDate('2020-02-29', 1), '2020-03-01');
  assert.equal(shiftDate('2021-02-28', 1), '2021-03-01');
  assert.equal(shiftDate('2020-03-01', -1), '2020-02-29');
  assert.equal(dateAtIndex('2020-01-01', 730), '2021-12-31');
});

test('date range membership does not clamp', () => {
  assert.equal(dateIndexWithin('2020-01-01', '2021-12-31', '2020-01-01'), 0);
  assert.equal(dateIndexWithin('2020-01-01', '2021-12-31', '2020-02-29'), 59);
  assert.equal(dateIndexWithin('2020-01-01', '2021-12-31', '2021-12-31'), 730);
  assert.equal(dateIndexWithin('2020-01-01', '2021-12-31', '2019-12-31'), null);
  assert.equal(dateIndexWithin('2020-01-01', '2021-12-31', '2022-01-01'), null);
  assert.equal(dateIndexWithin('2020-01-01', '2021-12-31', 'nope'), null);
});

test('playback advances one day and stops at the last day', () => {
  const base = {
    start: '2020-01-01', end: '2021-12-31',
    displayedDate: '2020-02-28', requestedDate: '2020-02-28',
    ready: true, playing: true,
  };
  assert.equal(nextPlaybackDate(base), '2020-02-29');
  assert.equal(nextPlaybackDate({ ...base, displayedDate: '2020-02-29', requestedDate: '2020-02-29' }), '2020-03-01');
  // Never advances while a frame is still loading or not yet applied.
  assert.equal(nextPlaybackDate({ ...base, ready: false }), null);
  assert.equal(nextPlaybackDate({ ...base, requestedDate: '2020-03-01' }), null);
  // Stops on the final day instead of silently restarting.
  assert.equal(nextPlaybackDate({ ...base, displayedDate: '2021-12-31', requestedDate: '2021-12-31' }), null);
  assert.equal(nextPlaybackDate({ ...base, playing: false }), null);
});

test('request identities include every selection component', () => {
  const a = fieldIdentity({ datasetId: 'earth_merra2_daily_v1', fingerprint: FINGERPRINT, variable: 'TO3', date: '2020-01-01' });
  const b = fieldIdentity({ datasetId: 'earth_merra2_daily_v1', fingerprint: FINGERPRINT, variable: 'TO3', date: '2020-01-02' });
  const c = fieldIdentity({ datasetId: 'earth_merra2_daily_v1', fingerprint: FINGERPRINT, variable: 'T2M', date: '2020-01-01' });
  const d = fieldIdentity({ datasetId: 'earth_merra2_daily_v1', fingerprint: 'b'.repeat(64), variable: 'TO3', date: '2020-01-01' });
  assert.equal(new Set([a, b, c, d]).size, 4);

  assert.notEqual(
    regionalIdentity({ datasetId: 'x', fingerprint: FINGERPRINT, variable: 'TO3', start: '2020-01-01', end: '2020-01-31' }),
    regionalIdentity({ datasetId: 'x', fingerprint: FINGERPRINT, variable: 'TO3', start: '2020-01-01', end: '2020-02-01' }),
  );
  assert.notEqual(
    pointIdentity({ datasetId: 'x', fingerprint: FINGERPRINT, variable: 'TO3', lat: 0, lon: 0 }),
    pointIdentity({ datasetId: 'x', fingerprint: FINGERPRINT, variable: 'TO3', lat: 0, lon: 5 }),
  );
});

test('field payload validation rejects identity, shape and value mismatches', () => {
  assert.equal(isValidFieldPayload(fieldPayload(), fieldExpectation), true);

  assert.equal(isValidFieldPayload(fieldPayload({ variable: 'T2M' }), fieldExpectation), false);
  assert.equal(isValidFieldPayload(fieldPayload({ units: 'K' }), fieldExpectation), false);
  assert.equal(isValidFieldPayload(fieldPayload({ date: '2020-03-01' }), fieldExpectation), false);
  assert.equal(isValidFieldPayload(fieldPayload({ dataset_fingerprint: 'b'.repeat(64) }), fieldExpectation), false);
  assert.equal(isValidFieldPayload(fieldPayload({ dataset_id: 'other' }), fieldExpectation), false);
  assert.equal(isValidFieldPayload(fieldPayload({ planet: 'mars' }), fieldExpectation), false);
  // A transposed / non-ascending axis must not pass.
  assert.equal(isValidFieldPayload(fieldPayload({ lat: [4, 0, -4] }), fieldExpectation), false);
  assert.equal(isValidFieldPayload(fieldPayload({ lon: [0, 0, 5] }), fieldExpectation), false);
  // Row width must match the longitude axis.
  assert.equal(isValidFieldPayload(fieldPayload({ field: [[1, 2], [3, 4], [5, 6]] }), fieldExpectation), false);
  assert.equal(isValidFieldPayload(fieldPayload({ field: [[1, 2, 3], [4, 5, 6]] }), fieldExpectation), false);
  // NaN / null values are never valid field values.
  assert.equal(isValidFieldPayload(fieldPayload({ field: [[1, 2, 3], [4, null, 6], [7, 8, 9]] }), fieldExpectation), false);
  assert.equal(isValidFieldPayload(fieldPayload({ field: [[1, 2, 3], [4, NaN, 6], [7, 8, 9]] }), fieldExpectation), false);
  // Coverage must declare a non-wrapping regional extent.
  assert.equal(isValidFieldPayload(fieldPayload({ coverage: { latitude_range: [-60, 60], longitude_range: [-120, 120], wrap_longitude: true } }), fieldExpectation), false);
  assert.equal(isValidFieldPayload(null, fieldExpectation), false);
});

test('series payload validation checks identity, continuity and lengths', () => {
  const expectation = {
    datasetId: 'earth_merra2_daily_v1',
    fingerprint: FINGERPRINT,
    variable: 'TO3',
    start: '2020-02-28',
    end: '2020-03-01',
  };
  const regional = {
    dataset_id: 'earth_merra2_daily_v1',
    dataset_version: 'v1',
    dataset_fingerprint: FINGERPRINT,
    planet: 'earth',
    variable: 'TO3',
    units: 'DU',
    start: '2020-02-28',
    end: '2020-03-01',
    dates: ['2020-02-28', '2020-02-29', '2020-03-01'],
    values: [1, 2, 3],
    aggregation: 'cos_lat_sample_mean',
    coverage: { latitude_range: [-60, 60], longitude_range: [-120, 120], wrap_longitude: false },
  };

  assert.equal(isValidRegionalPayload(regional, expectation), true);
  // A gap in the daily axis must be rejected: no silent neighbour substitution.
  assert.equal(isValidRegionalPayload({ ...regional, dates: ['2020-02-28', '2020-03-01'], values: [1, 2] }, expectation), false);
  // Non-increasing dates are invalid.
  assert.equal(isValidRegionalPayload({ ...regional, dates: ['2020-02-28', '2020-02-28', '2020-03-01'], values: [1, 2, 3] }, expectation), false);
  // Length mismatch between dates and values.
  assert.equal(isValidRegionalPayload({ ...regional, values: [1, 2] }, expectation), false);
  assert.equal(isValidRegionalPayload({ ...regional, values: [1, 2, null] }, expectation), false);
  assert.equal(isValidRegionalPayload({ ...regional, aggregation: 'mean' }, expectation), false);
  // Window endpoints must match what was requested.
  assert.equal(isValidRegionalPayload(regional, { ...expectation, end: '2020-03-02' }), false);
  assert.equal(isValidRegionalPayload(regional, { ...expectation, variable: 'T2M' }), false);

  const point = {
    ...regional,
    requested: { lat: 0, lon: 0 },
    grid_point: { lat: 0, lon: 0, lat_index: 15, lon_index: 24 },
    selection: 'nearest_grid_point',
  };
  assert.equal(isValidPointPayload(point, expectation), true);
  assert.equal(isValidPointPayload({ ...point, selection: 'interpolated' }, expectation), false);
  assert.equal(isValidPointPayload({ ...point, grid_point: { lat: 0, lon: 0, lat_index: 1.5, lon_index: 24 } }, expectation), false);
  assert.equal(isValidPointPayload({ ...point, values: [1, 2] }, expectation), false);
});

test('descriptor must be available and complete before any data request', () => {
  const descriptor = {
    dataset_id: 'earth_merra2_daily_v2',
    availability: 'available',
    capabilities: { web_overview: true },
    dataset_fingerprint: FINGERPRINT,
    time: { start: '2020-01-01', end: '2021-12-31' },
    channel_order: ['TO3'],
  };
  assert.equal(canRequestEarthData(descriptor), true);
  assert.equal(canRequestEarthData({ ...descriptor, availability: 'missing' }), false);
  assert.equal(canRequestEarthData({ ...descriptor, capabilities: { web_overview: false } }), false);
  assert.equal(canRequestEarthData({ ...descriptor, dataset_fingerprint: 'short' }), false);
  assert.equal(canRequestEarthData({ ...descriptor, time: {} }), false);
  assert.equal(canRequestEarthData({ ...descriptor, channel_order: [] }), false);
  assert.equal(canRequestEarthData(null), false);
});

test('initial selection derives from the descriptor, never hardcoded dates', () => {
  const descriptor = {
    time: { start: '2020-01-01', end: '2021-12-31' },
  };
  assert.deepEqual(initialEarthSelection(descriptor, null), {
    date: '2020-01-01', variable: 'TO3', point: null,
  });
  assert.deepEqual(initialEarthSelection(descriptor, { date: '2020-02-29', variable: 'T2M', point: { lat: 0, lon: 5 } }), {
    date: '2020-02-29', variable: 'T2M', point: { lat: 0, lon: 5 },
  });
  // Out-of-range or unknown selections fall back to the declared start/TO3.
  assert.deepEqual(initialEarthSelection(descriptor, { date: '2019-01-01', variable: 'wind', point: { lat: 'x', lon: 0 } }), {
    date: '2020-01-01', variable: 'TO3', point: null,
  });
  assert.deepEqual(initialEarthSelection({ time: { start: '2020-01-01', end: '2021-12-31' } }, { variable: 'U10M' }), {
    date: '2020-01-01', variable: 'U10M', point: null,
  });
});

test('wind variables use the diverging scale, scalars keep the user ramp', () => {
  assert.equal(earthColormap('U10M', 'viridis'), 'rdbu');
  assert.equal(earthColormap('V10M', 'viridis'), 'rdbu');
  assert.equal(earthColormap('TO3', 'viridis'), 'viridis');
  assert.equal(earthColormap('T2M', undefined), 'inferno');
  assert.equal(earthColormap('SWGDN', 'plasma'), 'plasma');
});


test('v2 field must cover real global cell edges and use global mean semantics', () => {
  const expected = { ...fieldExpectation, datasetId: 'earth_merra2_daily_v2' };
  const lat = Array.from({ length: 36 }, (_, i) => -87.5 + i * 5);
  const lon = Array.from({ length: 72 }, (_, i) => -177.5 + i * 5);
  const payload = fieldPayload({ dataset_id: expected.datasetId, lat, lon,
    field: lat.map(() => lon.map(() => 300)),
    coverage: { latitude_range: [-90, 90], longitude_range: [-180, 180], wrap_longitude: true },
  });
  assert.equal(isValidFieldPayload(payload, expected), true);
  assert.equal(isValidFieldPayload({ ...payload, coverage: { ...payload.coverage, latitude_range: [-87.5, 87.5] } }, expected), false);
});
