import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMarsAnalysisBoard } from './marsAnalysisBoardModel.js';

const getPanel = (board, id) => board.panels.find((panel) => panel.id === id);
const heatmap = (x, values) => ({ x, y: [0], z: [values] });
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

test('missing data keeps three localized empty panels in every mode', () => {
  for (const mode of ['temporal', 'drivers', 'dynamics']) {
    for (const data of [null, {}, { x: [], y: [], z: [] }]) {
      const board = buildMarsAnalysisBoard({ mode, data, isZh: false });
      assert.equal(board.panels.length, 3);
      assert.equal(new Set(board.panels.map((panel) => panel.id)).size, 3);
      for (const panel of board.panels) {
        assert.equal(panel.empty, true);
        assert.deepEqual(panel.data, []);
        assert.ok(panel.title.length > 0);
        assert.ok(panel.layout.xaxis);
        assert.ok(panel.layout.yaxis);
      }
      assert.ok(board.note.length > 0);
    }
  }
  const en = buildMarsAnalysisBoard({ mode: 'temporal', isZh: false });
  const zh = buildMarsAnalysisBoard({ mode: 'temporal', isZh: true });
  assert.notEqual(en.panels[0].title, zh.panels[0].title);
  assert.notEqual(en.note, zh.note);
});

test('temporal panels retain zero and missing samples while converting ozone units', () => {
  const data = { x: [0, 90, 180], y: [-75, 0, 75], z: [[0, 20, null], [10, null, NaN], [20, 40, Infinity]] };
  const board = buildMarsAnalysisBoard({ mode: 'temporal', data, units: { ozone: 'DU' }, isZh: false });
  const season = getPanel(board, 'season');
  assert.deepEqual(season.data[0].x, data.x);
  assert.deepEqual(season.data[0].y, data.y);
  assert.deepEqual(season.data[0].z, [[0, 2, null], [1, null, null], [2, 4, null]]);
  assert.deepEqual(getPanel(board, 'annual').data[0].y, [1, 3, null]);
  assert.equal(getPanel(board, 'annual').data[0].connectgaps, false);
  assert.match(getPanel(board, 'annual').title, /equal.*latitude/i);
  assert.match(getPanel(board, 'annual').layout.yaxis.title, /DU/);
  assert.deepEqual(getPanel(board, 'amplitude').data[0].x, [2, null, 0, null, 2]);
  assert.equal(getPanel(board, 'amplitude').data[0].orientation, 'h');
  assert.match(board.note, /equal.*latitude|latitude.*equal/i);
});

test('absolute temperatures convert to Celsius but seasonal amplitude stays a temperature difference', () => {
  const board = buildMarsAnalysisBoard({ mode: 'temporal', data: heatmap([0, 90], [273.15, 283.15]), variable: 'Temperature', units: { temperature: 'C' } });
  assert.deepEqual(getPanel(board, 'season').data[0].z, [[0, 10]]);
  assert.deepEqual(getPanel(board, 'annual').data[0].y, [0, 10]);
  assert.equal(getPanel(board, 'amplitude').data[0].x[2], 10);
  assert.match(getPanel(board, 'amplitude').layout.xaxis.title, /°C/);
});

test('wind and solar temporal panels have physical units', () => {
  const wind = buildMarsAnalysisBoard({ mode: 'temporal', data: heatmap([0, 90], [-1, 2]), variable: 'U_Wind', units: { wind: 'km/h' } });
  assert.deepEqual(getPanel(wind, 'annual').data[0].y, [-3.6, 7.2]);
  close(getPanel(wind, 'amplitude').data[0].x[2], 10.8);
  assert.match(getPanel(wind, 'annual').layout.yaxis.title, /km\/h/);
  const solar = buildMarsAnalysisBoard({ mode: 'temporal', data: heatmap([0], [50]), variable: 'Solar_Flux_DN' });
  assert.match(getPanel(solar, 'annual').layout.yaxis.title, /W\/m²/);
});

test('invalid and ragged cells become null without shifting axes', () => {
  const board = buildMarsAnalysisBoard({ mode: 'temporal', data: { x: [0, 90, 180], y: [-45, 45], z: [[1, '2'], null] } });
  assert.deepEqual(getPanel(board, 'season').data[0].z, [[1, null, null], [null, null, null]]);
  assert.deepEqual(getPanel(board, 'annual').data[0].y, [1, null, null]);
  const empty = buildMarsAnalysisBoard({ mode: 'temporal', data: heatmap([0, 10], [null, NaN]) });
  assert.ok(empty.panels.every((panel) => panel.empty && panel.data.length === 0));
});

test('drivers pair actual common Ls coordinates even when reference order differs', () => {
  const board = buildMarsAnalysisBoard({ mode: 'drivers', data: heatmap([0, 10, 20, 30], [999, 2, 4, 6]), reference: heatmap([30, 10, 20, 40], [100, 10, 40, 999]), variable: 'U_Wind', units: { ozone: 'DU', wind: 'km/h' }, isZh: false });
  const scatter = getPanel(board, 'scatter');
  assert.deepEqual(scatter.data[0].x, [7.2, 14.4, 21.6]);
  assert.deepEqual(scatter.data[0].y, [1, 4, 10]);
  assert.deepEqual(scatter.data[0].customdata, [10, 20, 30]);
  const regression = scatter.data[1];
  assert.equal(regression.x.length, 2);
  close(regression.y[0], 0.5);
  close(regression.y[1], 9.5);
  assert.match(scatter.layout.xaxis.title, /km\/h/);
  assert.match(scatter.layout.yaxis.title, /DU/);
  assert.deepEqual(getPanel(board, 'evolution').data[0].x, [10, 20, 30]);
});

test('standardized co-evolution preserves nulls instead of inserting zero', () => {
  const board = buildMarsAnalysisBoard({ mode: 'drivers', data: heatmap([0, 10, 20, 30], [1, null, 3, 5]), reference: heatmap([0, 10, 20, 30], [2, 4, null, 6]), variable: 'Temperature' });
  const evolution = getPanel(board, 'evolution');
  assert.equal(evolution.data[0].y[1], null);
  assert.equal(evolution.data[1].y[2], null);
  assert.equal(evolution.data[0].connectgaps, false);
  close(evolution.data[0].y[0], -Math.sqrt(1.5));
  close(evolution.data[0].y[2], 0);
  close(evolution.data[1].y[0], -Math.sqrt(1.5));
  assert.equal(getPanel(board, 'scatter').data[0].x.length, 2);
});

test('lag correlation uses nonwrapped finite runs and reports sample counts', () => {
  const x = [0, 5, 10, 15, 20, 25, 30];
  const values = [0, 1, 4, null, 2, 3, 7];
  const board = buildMarsAnalysisBoard({ mode: 'drivers', data: heatmap(x, values), reference: heatmap(x, values), variable: 'U_Wind', isZh: false });
  const lag = getPanel(board, 'lag');
  const trace = lag.data[0];
  assert.match(lag.layout.xaxis.title, /Ls.*°|°.*Ls/);
  close(trace.y[trace.x.indexOf(0)], 1);
  assert.equal(trace.customdata[trace.x.indexOf(0)], 6);
  assert.equal(trace.customdata[trace.x.indexOf(5)], 4);
  assert.equal(trace.y[trace.x.indexOf(10)], null);
  assert.equal(trace.customdata[trace.x.indexOf(10)], 2);
  assert.ok(trace.x.every((value) => Math.abs(value) <= 30));
  assert.match(board.note, /positive lag.*ozone|positive lag.*O3/i);
});

test('lag calculation does not bridge a coordinate omitted from only one source', () => {
  const board = buildMarsAnalysisBoard({ mode: 'drivers', data: heatmap([0, 5, 10, 15, 20, 25], [0, 1, 2, 3, 4, 5]), reference: heatmap([0, 5, 15, 20, 25], [0, 1, 3, 4, 5]), variable: 'U_Wind', isZh: false });
  const trace = getPanel(board, 'lag').data[0];
  const stepIndex = trace.x.indexOf(1);
  assert.match(getPanel(board, 'lag').layout.xaxis.title, /sample steps/i);
  assert.equal(trace.customdata[stepIndex], 3);
  assert.match(board.note, /spacing|cadence/i);
});

test('constant drivers have no fabricated fit or zero correlation', () => {
  const board = buildMarsAnalysisBoard({ mode: 'drivers', data: heatmap([0, 10, 20], [3, 3, 3]), reference: heatmap([0, 10, 20], [1, 2, 3]), variable: 'U_Wind' });
  assert.equal(getPanel(board, 'scatter').data.length, 1);
  assert.equal(getPanel(board, 'lag').empty, true);
  assert.deepEqual(getPanel(board, 'lag').data, []);
  assert.deepEqual(getPanel(board, 'evolution').data[0].y, [null, null, null]);
});

test('identical noninteger constants never produce a fit, Z-score, or lag correlation', () => {
  for (const values of [[0.1, 0.1, 0.1], [0.1, null, 0.1, 0.1]]) {
    const x = values.map((_, index) => index * 5);
    const board = buildMarsAnalysisBoard({ mode: 'drivers', data: heatmap(x, values), reference: heatmap(x, values), variable: 'U_Wind' });
    assert.equal(getPanel(board, 'scatter').data.length, 1, 'a constant driver cannot define a regression slope');
    assert.deepEqual(getPanel(board, 'scatter').data[0].x, [0.1, 0.1, 0.1]);
    assert.equal(getPanel(board, 'evolution').empty, true, 'both constant Z-scores are undefined');
    assert.equal(getPanel(board, 'lag').empty, true, 'constant Pearson correlation is undefined');
  }
});

test('constant decimals on either side stay undefined while a valid horizontal fit is retained', () => {
  const x = [0, 5, 10, 15];
  const constant = [0.1, null, 0.1, 0.1];
  const varying = [1, 2, 3, 4];
  for (const constantDriver of [true, false]) {
    const board = buildMarsAnalysisBoard({ mode: 'drivers', data: heatmap(x, constantDriver ? constant : varying), reference: heatmap(x, constantDriver ? varying : constant), variable: 'U_Wind' });
    assert.deepEqual(getPanel(board, 'evolution').data[constantDriver ? 0 : 1].y, [null, null, null, null]);
    assert.equal(getPanel(board, 'lag').empty, true);
    const scatter = getPanel(board, 'scatter');
    assert.equal(scatter.data.length, constantDriver ? 1 : 2);
    if (!constantDriver) assert.deepEqual(scatter.data[1].y, [0.1, 0.1]);
  }
});

test('changing valid latitude counts does not turn a constant decimal field into a varying series', () => {
  const data = { x: [0, 5, 10, 15], y: [-20, 0, 20], z: [[0.1, 0.1, 0.1, 0.1], [0.1, null, 0.1, 0.1], [0.1, null, null, 0.1]] };
  const temporal = buildMarsAnalysisBoard({ mode: 'temporal', data, variable: 'U_Wind' });
  assert.deepEqual(getPanel(temporal, 'annual').data[0].y, [0.1, 0.1, 0.1, 0.1]);
  assert.equal(getPanel(temporal, 'amplitude').data[0].x[2], 0);
  const drivers = buildMarsAnalysisBoard({ mode: 'drivers', data, reference: data, variable: 'U_Wind' });
  assert.equal(getPanel(drivers, 'scatter').data.length, 1);
  assert.equal(getPanel(drivers, 'evolution').empty, true);
  assert.equal(getPanel(drivers, 'lag').empty, true);
});

test('representably distinct nearby decimals retain real standardized variation, fit, and correlation', () => {
  const step = Number.EPSILON / 16;
  const values = [0.1, 0.1 + step, 0.1 + 2 * step];
  assert.equal(new Set(values).size, 3, 'the fixture differs by representable values');
  const data = heatmap([0, 5, 10], values);
  const board = buildMarsAnalysisBoard({ mode: 'drivers', data, reference: data, variable: 'U_Wind' });
  const evolution = getPanel(board, 'evolution');
  assert.equal(evolution.empty, false);
  assert.ok(evolution.data.every((trace) => trace.y.every(Number.isFinite) && new Set(trace.y).size === 3));
  const scatter = getPanel(board, 'scatter');
  assert.equal(scatter.data.length, 2);
  assert.deepEqual(scatter.data[1].y, [values[0], values[2]]);
  const lag = getPanel(board, 'lag').data[0];
  close(lag.y[lag.x.indexOf(0)], 1);
});

test('disjoint driver and ozone Ls arrays return three empty panels', () => {
  const board = buildMarsAnalysisBoard({ mode: 'drivers', data: heatmap([0, 10], [1, 2]), reference: heatmap([5, 15], [2, 4]), variable: 'Temperature' });
  assert.ok(board.panels.every((panel) => panel.empty));
});

test('spatial temperature anomalies and RMS are differences even with Celsius settings', () => {
  const board = buildMarsAnalysisBoard({ mode: 'dynamics', data: { x: [0, 180], y: [-75, 75], z: [[-2, 2], [null, 4]], min: -2, max: 4 }, variable: 'Temperature', units: { temperature: 'C' }, isZh: false });
  const map = getPanel(board, 'anomaly').data[0];
  assert.deepEqual(map.z, [[-2, 2], [null, 4]]);
  assert.equal(map.colorscale, 'RdBu');
  assert.equal(map.zmin, -4);
  assert.equal(map.zmax, 4);
  assert.equal(map.zmid, 0);
  assert.deepEqual(getPanel(board, 'rms').data[0].x, [4, null, null, null, 2]);
  assert.deepEqual(getPanel(board, 'span').data[0].x, [0, null, null, null, 4]);
  assert.match(getPanel(board, 'rms').layout.xaxis.title, /°C/);
  assert.match(board.note, /spatial|zonal/i);
});

test('spatial maps normalize unambiguous transposed matrices and apply ozone or wind scale', () => {
  const data = { x: [0, 120, 240], y: [-75, 75], z: [[-10, 20], [0, null], [10, 40]] };
  const ozone = buildMarsAnalysisBoard({ mode: 'dynamics', data, units: { ozone: 'DU' } });
  assert.deepEqual(getPanel(ozone, 'anomaly').data[0].z, [[-1, 0, 1], [2, null, 4]]);
  close(getPanel(ozone, 'rms').data[0].x[0], Math.sqrt(10));
  const wind = buildMarsAnalysisBoard({ mode: 'dynamics', data, variable: 'V_Wind', units: { wind: 'km/h' } });
  assert.deepEqual(getPanel(wind, 'anomaly').data[0].z[0], [-36, 0, 36]);
  assert.equal(getPanel(wind, 'span').data[0].x[4], 72);
});

test('all modes leave source coordinates, matrix cells, and settings untouched', () => {
  const data = { x: [0, 10, 20], y: [-45, 45], z: [[273.15, null, 283.15], [280, 290, 300]], min: -10, max: 300 };
  const reference = heatmap([0, 10, 20], [1, 2, 3]);
  const units = { ozone: 'DU', temperature: 'C', wind: 'km/h' };
  const before = structuredClone({ data, reference, units });
  function freeze(value) {
    if (value && typeof value === 'object') {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
    return value;
  }
  freeze({ data, reference, units });
  for (const mode of ['temporal', 'drivers', 'dynamics']) {
    const result = buildMarsAnalysisBoard({ mode, data, reference, units, variable: 'Temperature' });
    const trace = result.panels.find((panel) => panel.data.length)?.data[0];
    if (trace?.x?.length) trace.x[0] = 12345;
  }
  assert.deepEqual({ data, reference, units }, before);
});
