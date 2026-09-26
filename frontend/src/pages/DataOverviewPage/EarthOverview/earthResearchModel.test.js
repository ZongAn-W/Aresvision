import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EARTH_POLAR_SCOPE_MIN_ABS_LATITUDE,
  buildBandDiagnostics,
  buildCorrelationMatrix,
  buildEnvironmentSeries,
  buildExtremesTable,
  buildEarthInsightSnapshot as buildInsightSnapshot,
  buildPolarSummary,
  buildRegionalTrend,
  buildRelationship,
  buildSeasonalHeatmap,
  buildSpatialAnomaly,
  peakLagDays,
  summarizeCorrelationForInsight,
  summarizeExtremesForInsight,
  summarizePolarForInsight,
  summarizeRelationshipForInsight,
  summarizeSpatialForInsight,
} from './earthResearchModel.js';
import { EARTH_VARIABLE_UNITS } from './earthOverviewModel.js';

const DATES = ['2020-01-01', '2020-01-02', '2020-01-03'];
const LATITUDE = [-87.5, 0, 87.5];
const BANDS = [
  { id: 'south_polar', min_latitude: -87.5, max_latitude: -62.5, latitude_values: [-87.5], grid_point_count: 6 },
  { id: 'north_polar', min_latitude: 62.5, max_latitude: 87.5, latitude_values: [87.5], grid_point_count: 6 },
];

function suite(overrides = {}) {
  return {
    dataset_id: 'earth_merra2_daily_v2',
    planet: 'earth',
    year: 2020,
    dates: DATES,
    day_count: 3,
    latitude: LATITUDE,
    bands: BANDS,
    variables: [
      { id: 'TO3', units: 'DU' },
      { id: 'T2M', units: 'K' },
      { id: 'SWGDN', units: 'W m-2' },
    ],
    aggregation: {
      regional: 'spherical_cell_area_mean',
      seasonal: 'equal_longitude_mean',
      band: 'cell_area_weighted_band_mean',
    },
    seasonal: {
      TO3: { z: [[300, 301, 302], [310, 311, 312], [320, 321, 322]], units: 'DU', aggregation: 'equal_longitude_mean' },
    },
    regional_series: {
      TO3: [300, 301, 302],
      T2M: [250, 251, 252],
      SWGDN: [100, 110, 120],
    },
    band_series: {
      south_polar: { TO3: [280, 281, 282], T2M: [230, 231, 232] },
    },
    extremes: {
      south_polar: {
        TO3: {
          max_value: 282, max_date: '2020-01-03', min_value: 280, min_date: '2020-01-01', peak_to_peak: 2,
        },
        T2M: {
          max_value: 232, max_date: '2020-01-03', min_value: 230, min_date: '2020-01-01', peak_to_peak: 2,
        },
      },
    },
    zscore: {
      TO3: { values: [-1, 0, 1], reason: null },
      T2M: { values: [0, 0, 0], reason: 'constant_series' },
    },
    relationships: {
      global: {
        correlation: {
          variable_order: ['TO3', 'T2M', 'SWGDN'],
          r: [[null, 0.9, 0.5], [0.9, null, 0.2], [0.5, 0.2, null]],
          n: [[3, 3, 3], [3, 3, 3], [3, 3, 3]],
          reason: [[null, null, null], [null, null, null], [null, null, null]],
        },
        solar_ozone: {
          r: 0.5, n: 3, reason: null,
          regression: { slope: 0.02, intercept: 298 },
          lag: [
            { lag_days: -1, r: 0.1, n: 2, reason: null },
            { lag_days: 0, r: 0.5, n: 3, reason: null },
            { lag_days: 2, r: -0.8, n: 1, reason: null },
          ],
        },
        temperature_ozone: {
          r: 0.9, n: 3, reason: null,
          regression: { slope: 1.0, intercept: 50 },
          lag: [{ lag_days: 0, r: 0.9, n: 3, reason: null }],
        },
      },
    },
    ...overrides,
  };
}

test('seasonal heatmap keeps the real date axis and one row per latitude', () => {
  const model = buildSeasonalHeatmap(suite(), 'TO3', { isZh: true });
  assert.deepEqual(model.x, DATES);
  assert.deepEqual(model.y, LATITUDE);
  assert.equal(model.z.length, LATITUDE.length);
  assert.equal(model.z[0].length, DATES.length);
  assert.equal(model.units, 'DU');
  assert.equal(model.xKind, 'date');
  assert.equal(model.aggregation, 'equal_longitude_mean');
  assert.equal(buildSeasonalHeatmap(suite(), 'T2M'), null);
});

test('annual trend keeps Earth physical units and never borrows Mars units', () => {
  const model = buildRegionalTrend(suite(), { isZh: true });
  assert.deepEqual(model.x, DATES);
  const units = Object.fromEntries(model.series.map((entry) => [entry.id, entry.units]));
  assert.equal(units.TO3, 'DU');
  assert.equal(units.T2M, 'K');
  assert.equal(units.SWGDN, 'W m-2');
  // Mars ozone happens to also be a column amount, but no Mars unit string may appear.
  for (const unit of Object.values(units)) {
    assert.doesNotMatch(unit, /um-atm|Ls/i);
  }

  const normalized = buildRegionalTrend(suite(), { isZh: false, normalized: true });
  assert.equal(normalized.yTitle, 'Z-score');
  assert.deepEqual(normalized.series[0].values, [-1, 0, 1]);
});

test('extremes table reports the real sampled latitudes and nullable metrics', () => {
  const rows = buildExtremesTable(suite(), 'TO3');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].bandId, 'south_polar');
  assert.equal(rows[0].minLatitude, -87.5);
  assert.equal(rows[0].maxDate, '2020-01-03');
  assert.equal(rows[0].peakToPeak, 2);
  assert.equal(rows[0].units, 'DU');
  // A band with no entry stays null rather than becoming zero.
  assert.equal(rows[1].max, null);
  assert.equal(rows[1].peakToPeak, null);
  assert.equal(buildExtremesTable({}, 'TO3'), null);
});

test('standardized comparison uses dimensionless values and never falls back to physical values', () => {
  const model = buildRegionalTrend(suite(), { normalized: true });
  const ozone = model.series.find((entry) => entry.id === 'TO3');
  assert.equal(ozone.units, '');
  assert.deepEqual(ozone.values, [-1, 0, 1]);
  const missing = model.series.find((entry) => entry.id === 'SWGDN');
  assert.deepEqual(missing.values, [null, null, null]);
  assert.equal(missing.reason, 'standardization_unavailable');
  assert.deepEqual(buildRegionalTrend(suite()).series.find((entry) => entry.id === 'SWGDN').values, [100, 110, 120]);
});

test('environment series can switch between the globe and a latitude band', () => {
  const global = buildEnvironmentSeries(suite(), { bandId: 'global', isZh: true });
  assert.equal(global.series.length, 3);
  assert.equal(global.bandId, 'global');

  const polar = buildEnvironmentSeries(suite(), { bandId: 'south_polar', isZh: true });
  assert.deepEqual(polar.series.map((entry) => entry.id), ['TO3', 'T2M']);
  assert.deepEqual(polar.series[0].values, [280, 281, 282]);
});

test('correlation model keeps null for undefined pairs and exposes counts', () => {
  const matrix = buildCorrelationMatrix(suite(), 'global');
  assert.deepEqual(matrix.labels, ['TO3', 'T2M', 'SWGDN']);
  assert.equal(matrix.r[0][0], null, 'the diagonal of an undefined pair must stay null');

  const summary = summarizeCorrelationForInsight(matrix);
  assert.deepEqual(summary.strongest[0].pair, 'TO3-T2M');
  assert.equal(summary.all.length, 3);
  assert.equal(buildCorrelationMatrix(suite(), 'missing_scope'), null);
});

test('relationship model reports slope units, sign convention and peak lag', () => {
  const solar = buildRelationship(suite(), 'global', 'solar_ozone');
  assert.equal(solar.driverVariable, 'SWGDN');
  assert.equal(solar.driverUnits, 'W m-2');
  assert.equal(solar.referenceUnits, 'DU');
  assert.equal(solar.regressionUnits, 'DU / (W m-2)');
  assert.equal(solar.x.length, solar.y.length);
  // Peak |r| must be reported as a lag in days, not as a physical response time.
  assert.equal(peakLagDays(solar.lag), 2);

  const coupling = buildRelationship(suite(), 'global', 'temperature_ozone');
  assert.equal(coupling.driverVariable, 'T2M');
  assert.equal(coupling.regressionUnits, 'DU / K');

  // 颜色必须是数值索引：把 ISO 日期字符串交给 Plotly 作为 marker.color 会让
  // 色标量到 NaN 尺寸（浏览器控制台出现 <rect height="NaN">）。
  assert.deepEqual(solar.colorValues, [0, 1, 2]);
  assert.equal(solar.colorValues.every((value) => Number.isFinite(value)), true);
  assert.equal(solar.colorTicks[0].date, DATES[0]);

  const summary = summarizeRelationshipForInsight(solar);
  assert.equal(summary.peak_lag_days, 2);
  assert.equal(summary.slope_units, 'DU / (W m-2)');
  assert.equal(buildRelationship(suite(), 'global', 'not_a_kind'), null);
});

test('spatial anomaly and band diagnostics keep original units and null metrics', () => {
  const spatial = {
    variable: 'TO3',
    units: 'DU',
    lat: LATITUDE,
    lon: [-177.5, -2.5, 177.5],
    anomaly: [[-2, 0, 2], [-1, 0, 1], [-3, 0, 3]],
    reference: 'annual_mean_minus_equal_longitude_mean',
    color_range: { min: -3, max: 3, centered_on_zero: true },
    bands: [
      { id: 'south_polar', rms: 1.6, peak_to_peak: 4, grid_point_count: 6 },
      { id: 'empty_band', rms: null, peak_to_peak: null, grid_point_count: 0 },
    ],
  };

  const model = buildSpatialAnomaly(spatial);
  assert.equal(model.z.length, LATITUDE.length);
  assert.equal(model.x.length, 3);
  assert.equal(model.units, 'DU');
  assert.equal(model.reference, 'annual_mean_minus_equal_longitude_mean');
  // Zero is always inside the anomaly colour range.
  assert.ok(model.colorRange.min < 0 && model.colorRange.max > 0);

  const rows = buildBandDiagnostics(spatial);
  assert.equal(rows[0].rms, 1.6);
  assert.equal(rows[1].rms, null);
  assert.equal(rows[1].gridPointCount, 0);

  const summary = summarizeSpatialForInsight(spatial);
  assert.equal(summary.bands[1].rms, null);
  assert.equal(buildSpatialAnomaly(null), null);
});

test('polar summary exposes the real scope and the daily-mean limitation', () => {
  const polar = {
    polar_scope: { min_abs_latitude: 60, sampling: 'daily_mean', note: 'diurnal_variation_not_resolvable' },
    dates: DATES,
    bands: [
      {
        id: 'north_polar',
        hemisphere: 'north',
        min_latitude: 62.5,
        max_latitude: 87.5,
        latitude_values: [62.5, 87.5],
        grid_point_count: 6,
        variables: {
          TO3: {
            units: 'DU', mean: 310, min_value: 300, min_date: '2020-01-01',
            max_value: 320, max_date: '2020-01-03', peak_to_peak: 20, series: [300, 310, 320],
          },
        },
      },
    ],
    hemisphere_contrast: { TO3: { n: 3, r: 0.5, reason: null, mean_difference: 2 } },
  };

  const model = buildPolarSummary(polar);
  assert.equal(model.minAbsLatitude, EARTH_POLAR_SCOPE_MIN_ABS_LATITUDE);
  assert.equal(model.sampling, 'daily_mean');
  assert.equal(model.note, 'diurnal_variation_not_resolvable');
  assert.equal(model.bands[0].min_latitude, 62.5);
  assert.equal(model.bands[0].grid_point_count, 6);
  assert.equal(buildPolarSummary(null), null);

  const summary = summarizePolarForInsight(model);
  assert.equal(summary.bands[0].TO3.includes('mean=310'), true);
  assert.equal(summary.bands[0].grid_points, 6);
  assert.equal(summary.note, 'diurnal_variation_not_resolvable');

  // 后端 _summary_limits 从 summary 起算最多 6 层：极区摘要必须保持扁平。
  const depth = (node, level = 0) => {
    if (Array.isArray(node)) {
      return node.reduce((deepest, item) => Math.max(deepest, depth(item, level + 1)), level);
    }
    if (node && typeof node === 'object') {
      return Object.values(node).reduce((deepest, item) => Math.max(deepest, depth(item, level + 1)), level);
    }
    return level;
  };
  assert.ok(
    depth({ cards: [{ card: 'polar', values: summary }] }) <= 6,
    `polar digest is too deep: ${depth({ cards: [{ card: 'polar', values: summary }] })}`,
  );
});

test('insight snapshot sends a digest only and matches the strict request contract', () => {
  const snapshot = buildInsightSnapshot({
    datasetId: 'earth_merra2_daily_v2',
    fingerprint: 'f'.repeat(64),
    year: 2020,
    date: '2020-06-15',
    variable: 'TO3',
    units: 'DU',
    scope: 'north_polar',
    cards: [
      { key: 'seasonalExtremes', state: { status: 'ready' }, values: summarizeExtremesForInsight(buildExtremesTable(suite(), 'TO3')), notes: [] },
    ],
  });

  // The backend request model is extra="forbid": only these keys may be sent.
  assert.deepEqual(
    Object.keys(snapshot).sort(),
    ['planet', 'dataset_id', 'expected_fingerprint', 'year', 'variable', 'date', 'scope', 'locale', 'question', 'summary'].sort(),
  );
  assert.deepEqual(Object.keys(snapshot.summary).sort(), ['cards', 'units']);
  assert.deepEqual(Object.keys(snapshot.summary.cards[0]).sort(), ['card', 'notes', 'values']);

  assert.equal(snapshot.planet, 'earth');
  assert.equal(snapshot.summary.units, 'DU');
  assert.equal(snapshot.year, 2020);
  assert.equal(snapshot.scope, 'north_polar');
  assert.equal(snapshot.locale, 'zh');
  assert.equal(snapshot.summary.cards[0].card, 'seasonalExtremes');
  // The digest must never contain a raw grid.
  const text = JSON.stringify(snapshot);
  assert.doesNotMatch(text, /"z":\[\[/);
  assert.ok(text.length < 20_000, 'the digest must stay small');
});

test('Earth variable units stay in physical units and are never Mars units', () => {
  assert.deepEqual(EARTH_VARIABLE_UNITS, {
    TO3: 'DU',
    U10M: 'm s-1',
    V10M: 'm s-1',
    T2M: 'K',
    SWGDN: 'W m-2',
  });
});
