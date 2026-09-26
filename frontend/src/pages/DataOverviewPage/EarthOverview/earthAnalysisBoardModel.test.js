import test from 'node:test';
import assert from 'node:assert/strict';

import { buildEarthAnalysisBoard as buildBoard } from './earthAnalysisBoardModel.js';

const DATES = ['2020-02-27', '2020-02-28', '2020-02-29', '2020-03-01'];
const BANDS = [{ id: 'south_polar' }, { id: 'tropics' }, { id: 'north_polar' }];

function makeSuite() {
  return {
    dates: [...DATES],
    latitude: [-75, 0, 75],
    bands: structuredClone(BANDS),
    variables: [{ id: 'TO3', units: 'DU' }, { id: 'T2M', units: 'K' }, { id: 'SWGDN', units: 'W m-2' }],
    seasonal: {
      TO3: { units: 'DU', z: [[250, 251, 252, 253], [300, 301, 302, 303], [350, 351, 352, 353]] },
      T2M: { units: 'K', z: [[240, 241, 242, 243], [280, 281, 282, 283], [245, 246, 247, 248]] },
    },
    // Deliberately different from a mean of latitude rows: preserve backend area weights.
    regional_series: { TO3: [310, 320, 340, 350], T2M: [280, 282, 284, 286], SWGDN: [100, 200, 300, 400] },
    band_series: {
      south_polar: { TO3: [100, 200, 300, 400], T2M: [230, 232, 234, 236], SWGDN: [10, 20, 30, 40] },
    },
    extremes: {
      south_polar: { TO3: { peak_to_peak: 30 }, T2M: { peak_to_peak: 6 } },
      tropics: { TO3: { peak_to_peak: null }, T2M: { peak_to_peak: 10 } },
      north_polar: { TO3: { peak_to_peak: 0 }, T2M: { peak_to_peak: 8 } },
    },
    relationships: {
      global: {
        temperature_ozone: { r: 0.82, n: 4, regression: { slope: 5, intercept: -1090 }, lag: [{ lag_days: 0, r: 0.82, n: 4, reason: null }] },
        solar_ozone: { r: 0.75, n: 4, regression: { slope: 0.15, intercept: 280 }, lag: [{ lag_days: 0, r: 0.75, n: 4, reason: null }] },
      },
      south_polar: {
        temperature_ozone: { r: 0.91, n: 4, regression: { slope: 50, intercept: -11400 }, lag: [{ lag_days: 0, r: 0.91, n: 4, reason: null }] },
        solar_ozone: {
          r: 0.4, n: 4, regression: { slope: 2, intercept: 75 },
          // earth_research_service.lagged_correlation returns lag_days/r/n/reason.
          lag: [
            { lag_days: -3, r: null, n: 1, reason: 'insufficient_samples' },
            { lag_days: -1, r: -0.2, n: 3, reason: null },
            { lag_days: 0, r: 0.4, n: 4, reason: null },
            { lag_days: 1, r: 0.7, n: 3, reason: null },
            { lag_days: 3, r: null, n: 1, reason: 'insufficient_samples' },
          ],
        },
      },
    },
  };
}

function makeSpatial() {
  return {
    variable: 'TO3', units: 'DU', lat: [-75, 0, 75], lon: [-120, 0, 120],
    anomaly: [[-4, null, 4], [-1, 0, 1], [-2, 0, 2]],
    color_range: { min: -4, max: 3, centered_on_zero: true },
    bands: [
      { id: 'south_polar', rms: 2.75, peak_to_peak: 8 },
      { id: 'tropics', rms: null, peak_to_peak: null },
      { id: 'north_polar', rms: 0, peak_to_peak: 0 },
    ],
  };
}

function freezeDeep(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}

test('temporal board preserves raw physical values, area-weighted global means, UTC dates and band amplitudes', () => {
  const suite = makeSuite();
  const { panels, note } = buildBoard({ mode: 'temporal', suite, isZh: false });
  assert.equal(panels.length, 3);
  const [seasonal, trend, amplitude] = panels;
  assert.equal(seasonal.data[0].type, 'heatmap');
  assert.deepEqual(seasonal.data[0].z, suite.seasonal.TO3.z);
  assert.equal(seasonal.data[0].colorscale, 'Viridis');
  assert.match(seasonal.data[0].colorbar.title.text, /DU/);
  assert.deepEqual(trend.data[0].y, [310, 320, 340, 350]);
  for (const panel of [seasonal, trend]) {
    assert.deepEqual(panel.data[0].x, DATES);
    assert.equal(panel.layout.xaxis.type, 'date');
    assert.match(panel.layout.xaxis.title.text, /UTC/);
    assert.equal(panel.empty, false);
  }
  assert.match(trend.layout.yaxis.title.text, /DU/);
  assert.equal(trend.data[0].line.color, '#6aa9ff');
  assert.deepEqual(amplitude.data[0].x, [30, null, 0]);
  assert.equal(amplitude.data[0].orientation, 'h');
  assert.deepEqual(amplitude.data[0].y, ['South polar', 'Tropics', 'North polar']);
  assert.match(amplitude.layout.xaxis.title.text, /DU/);
  assert.match(note, /area.weight/i);
});

test('selected Earth temperature keeps kelvin and its own backend amplitudes', () => {
  const { panels } = buildBoard({ mode: 'temporal', suite: makeSuite(), variable: 'T2M', isZh: false });
  assert.deepEqual(panels[0].data[0].z[0], [240, 241, 242, 243]);
  assert.deepEqual(panels[1].data[0].y, [280, 282, 284, 286]);
  assert.deepEqual(panels[2].data[0].x, [6, 10, 8]);
  assert.match(panels[1].layout.yaxis.title.text, /\(K\)/);
});

test('raw charts preserve zero and turn non-finite, missing and non-number values into gaps', () => {
  const suite = makeSuite();
  suite.regional_series.TO3 = [0, null, Infinity, '300'];
  suite.seasonal.TO3.z[0] = [null, undefined, NaN, 0];
  suite.extremes.south_polar.TO3.peak_to_peak = Infinity;
  const { panels } = buildBoard({ mode: 'temporal', suite });
  assert.deepEqual(panels[0].data[0].z[0], [null, null, null, 0]);
  assert.deepEqual(panels[1].data[0].y, [0, null, null, null]);
  assert.equal(panels[1].data[0].connectgaps, false);
  assert.deepEqual(panels[2].data[0].x, [null, null, 0]);
});

test('driver relationship uses the chosen scope and backend fit rather than recomputing a regression', () => {
  const suite = makeSuite();
  suite.band_series.south_polar.SWGDN = [10, null, 30, 40];
  suite.band_series.south_polar.TO3 = [100, 200, Infinity, 400];
  const { panels, note } = buildBoard({ mode: 'drivers', suite, driver: 'SWGDN', scope: 'south_polar', isZh: false });
  const [scatter] = panels;
  assert.deepEqual(scatter.data[0].x, [10, 40]);
  assert.deepEqual(scatter.data[0].y, [100, 400]);
  assert.deepEqual(scatter.data[0].text, [DATES[0], DATES[3]]);
  assert.deepEqual(scatter.data[1].x, [10, 40]);
  assert.deepEqual(scatter.data[1].y, [95, 155], 'use backend slope=2/intercept=75 exactly');
  assert.match(scatter.layout.xaxis.title.text, /W m-2/);
  assert.match(scatter.layout.yaxis.title.text, /DU/);
  assert.match(scatter.title, /South polar/);
  assert.match(note, /causal|causality/i);
  assert.match(note, /area.weight/i);
});

test('driver curves standardize finite samples per selected scope without filling missing dates', () => {
  const suite = makeSuite();
  suite.band_series.south_polar.T2M = [230, null, 234, NaN];
  suite.band_series.south_polar.TO3 = [100, 200, Infinity, 400];
  const { panels } = buildBoard({ mode: 'drivers', suite, scope: 'south_polar', isZh: false });
  const trend = panels[1];
  assert.equal(trend.data.length, 2);
  assert.deepEqual(trend.data[0].y, [-1, null, 1, null]);
  assert.equal(trend.data[1].y[2], null);
  const finiteOzone = trend.data[1].y.filter(Number.isFinite);
  assert.ok(Math.abs(finiteOzone.reduce((sum, value) => sum + value, 0)) < 1e-12);
  assert.ok(Math.abs(finiteOzone.reduce((sum, value) => sum + value ** 2, 0) / finiteOzone.length - 1) < 1e-12);
  assert.deepEqual(trend.data[0].x, DATES);
  assert.equal(trend.layout.xaxis.type, 'date');
  assert.match(trend.layout.yaxis.title.text, /Z-score/);
  assert.doesNotMatch(trend.layout.yaxis.title.text, /DU|\(K\)/);
  assert.equal(trend.data[0].line.color, '#6aa9ff');
  assert.equal(trend.data[1].line.color, '#ff9b70');
  assert.equal(trend.data[1].line.dash, 'dash');
  assert.ok(trend.data.every((trace) => trace.connectgaps === false));
});

test('lag curve keeps backend lag_days/r/n/reason rows and gaps without re-estimating correlation', () => {
  const { panels } = buildBoard({ mode: 'drivers', suite: makeSuite(), driver: 'SWGDN', scope: 'south_polar', isZh: false });
  const lag = panels[2];
  assert.deepEqual(lag.data[0].x, [-3, -1, 0, 1, 3]);
  assert.deepEqual(lag.data[0].y, [null, -0.2, 0.4, 0.7, null]);
  assert.deepEqual(lag.data[0].customdata, [[1, 'insufficient_samples'], [3, null], [4, null], [3, null], [1, 'insufficient_samples']]);
  assert.equal(lag.data[0].connectgaps, false);
  assert.match(lag.layout.xaxis.title.text, /days.*positive.*driver leads/i);
  assert.deepEqual(lag.layout.yaxis.range, [-1, 1]);
});

test('missing or invalid regression coefficients never create a fitted line', () => {
  for (const regression of [null, { slope: 1, intercept: null }, { slope: Infinity, intercept: 1 }, { slope: Number.MAX_VALUE, intercept: 0 }]) {
    const suite = makeSuite();
    suite.relationships.global.temperature_ozone.regression = regression;
    const { panels } = buildBoard({ mode: 'drivers', suite });
    assert.equal(panels[0].data.length, 1);
  }
});

test('constant or unavailable series have no invented standardized values or relationships', () => {
  const suite = makeSuite();
  suite.regional_series = { T2M: [280, 280, null, 280], TO3: [300, 300, 300, 300] };
  suite.relationships = { global: { temperature_ozone: { regression: null, lag: [{ lag_days: 0, r: null, n: 3, reason: 'constant_series' }] } } };
  const { panels, note } = buildBoard({ mode: 'drivers', suite, isZh: false });
  assert.equal(panels[1].empty, true);
  assert.ok(panels[1].data.every((trace) => trace.y.every((value) => value === null)));
  assert.equal(panels[2].empty, true);
  assert.match(note, /constant|zero variance/i);
  const absent = buildBoard({ mode: 'drivers', suite, scope: 'north_polar' });
  assert.ok(absent.panels.every((panel) => panel.empty));
});

test('constant decimal series stay empty despite roundoff in the sample mean', () => {
  const suite = makeSuite();
  suite.dates = Array.from({ length: 10 }, (_, index) => `2020-01-${String(index + 1).padStart(2, '0')}`);
  suite.regional_series = { T2M: Array(10).fill(0.1), TO3: Array(10).fill(300.1) };
  const { panels, note } = buildBoard({ mode: 'drivers', suite, isZh: false });
  assert.equal(panels[1].empty, true);
  assert.ok(panels[1].data.every((trace) => trace.y.every((value) => value === null)));
  assert.match(note, /constant|zero variance/i);
});

test('spatial board preserves backend anomaly/RMS/span with symmetric diverging units and nullable bars', () => {
  const spatial = makeSpatial();
  const { panels, note } = buildBoard({ mode: 'dynamics', spatial, isZh: false });
  assert.deepEqual(panels[0].data[0].z, spatial.anomaly);
  assert.deepEqual(panels[0].data[0].x, spatial.lon);
  assert.deepEqual(panels[0].data[0].y, spatial.lat);
  assert.equal(panels[0].data[0].colorscale, 'RdBu');
  assert.equal(panels[0].data[0].zmin, -4);
  assert.equal(panels[0].data[0].zmax, 4);
  assert.match(panels[0].data[0].colorbar.title.text, /DU/);
  assert.deepEqual(panels[1].data[0].x, [2.75, null, 0]);
  assert.deepEqual(panels[2].data[0].x, [8, null, 0]);
  assert.ok(panels.slice(1).every((panel) => panel.data[0].orientation === 'h'));
  assert.match(note, /same.latitude/i);
  assert.match(note, /area.weight/i);
});

test('empty or malformed inputs keep three stable panel identities with explicit empty states', () => {
  for (const mode of ['temporal', 'drivers', 'dynamics']) {
    const full = buildBoard({ mode, suite: makeSuite(), spatial: makeSpatial() });
    const absent = buildBoard({ mode });
    assert.equal(absent.panels.length, 3);
    assert.deepEqual(absent.panels.map((panel) => panel.id), full.panels.map((panel) => panel.id));
    assert.equal(new Set(absent.panels.map((panel) => panel.id)).size, 3);
    assert.ok(absent.panels.every((panel) => panel.empty === true));
  }
  const suite = makeSuite();
  suite.seasonal.TO3.z = [[1]];
  assert.equal(buildBoard({ mode: 'temporal', suite }).panels[0].empty, true);
  const spatial = makeSpatial();
  spatial.anomaly = [[1]];
  assert.equal(buildBoard({ mode: 'dynamics', spatial }).panels[0].empty, true);
});

test('all themes localize labels and leave frozen source data unchanged', () => {
  const suite = freezeDeep(makeSuite());
  const spatial = freezeDeep(makeSpatial());
  const original = structuredClone({ suite, spatial });
  for (const mode of ['temporal', 'drivers', 'dynamics']) {
    const zh = buildBoard({ mode, suite, spatial, isZh: true });
    const en = buildBoard({ mode, suite, spatial, isZh: false });
    assert.ok(zh.panels.every((panel) => /[\u4e00-\u9fff]/u.test(panel.title)));
    assert.ok(en.panels.every((panel) => !/[\u4e00-\u9fff]/u.test(panel.title)));
    assert.notEqual(zh.note, en.note);
    assert.doesNotMatch(JSON.stringify(en), /um-atm|solar longitude|Mars/i);
  }
  assert.deepEqual({ suite, spatial }, original);
});
