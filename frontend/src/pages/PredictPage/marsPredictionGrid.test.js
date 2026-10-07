import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { marsPredictionGrid } from './marsPredictionGrid.js';

const sample = () => ({ field: [[100, 110], [10, 20]], lat: [87.5, -87.5], lon: [-135, 45] });

test('north-high field rows retain their labels and draw at the top', () => {
  const data = sample();
  const grid = marsPredictionGrid(data);
  assert.equal(grid.field, data.field);
  assert.equal(grid.latitude, data.lat);
  assert.equal(grid.longitude, data.lon);
  assert.equal(grid.latCells[0].start, 0);
  assert.equal(grid.latCells[1].end, 1);
  assert.equal(grid.sphericalFieldData.latCenters, data.lat);
  assert.equal(grid.sphericalFieldData.lonCenters, data.lon);
  assert.equal(grid.sphericalFieldData.field[0][0], 100);
  assert.deepEqual(grid.lonTicks.map((tick) => tick.value), [-135, 45]);
});

test('ascending source rows are positioned by latitude without reversing the array', () => {
  const data = { ...sample(), field: [[10, 20], [100, 110]], lat: [-87.5, 87.5] };
  const grid = marsPredictionGrid(data);
  assert.equal(grid.field, data.field);
  assert.equal(grid.latCells[0].end, 1);
  assert.equal(grid.latCells[1].start, 0);
  assert.equal(grid.latTicks[0].value, -87.5);
});

test('nonuniform and descending longitude coordinates determine cell positions', () => {
  const data = { field: [[1, 2, 3], [4, 5, 6]], lat: [80, 20], lon: [170, 50, -30] };
  const grid = marsPredictionGrid(data);
  assert.equal(grid.longitude, data.lon);
  assert.equal(grid.lonCells[0].end, 1);
  assert.equal(grid.lonCells[2].start, 0);
  assert.notEqual(grid.lonCells[0].end - grid.lonCells[0].start, grid.lonCells[2].end - grid.lonCells[2].start);
});

test('missing or invalid coordinate axes never receive generated replacements', () => {
  for (const bad of [
    { ...sample(), lat: undefined }, { ...sample(), lon: [] },
    { ...sample(), lat: [87.5] }, { ...sample(), lon: [NaN, 45] },
    { ...sample(), lat: [0, 0] }, { ...sample(), field: [[1], [2, 3]] },
  ]) assert.equal(marsPredictionGrid(bad), null);
});

test('all three result fields use the same source coordinate mapping', () => {
  const base = sample();
  const fields = [base, { ...base, field: [[90, 100], [5, 15]] }, { ...base, field: [[10, 10], [5, 5]] }];
  const grids = fields.map(marsPredictionGrid);
  for (const grid of grids) {
    assert.equal(grid.latitude, base.lat);
    assert.equal(grid.longitude, base.lon);
    assert.deepEqual(grid.latCells, grids[0].latCells);
  }
});

test('Mars heatmaps and full-screen charts use the tested coordinate mapping', () => {
  const canvas = readFileSync(new URL('./PredictComponents.jsx', import.meta.url), 'utf8');
  const fullscreen = readFileSync(new URL('./PredictFullscreenHUD.jsx', import.meta.url), 'utf8');
  assert.match(canvas, /grid\.latCells\[li\]\.start/);
  assert.match(canvas, /grid\.lonCells\[lj\]\.start/);
  assert.doesNotMatch(canvas, /nLat - 1 - li/);
  assert.match(fullscreen, /const latitudes = grid\.latitude/);
  assert.match(fullscreen, /const longitudes = grid\.longitude/);
  assert.match(fullscreen, /fieldData=\{grid\.sphericalFieldData\}/);
  assert.match(fullscreen, /geometry=\{\{ latCenters: grid\.latitude, lonCenters: grid\.longitude \}\}/);
  assert.doesNotMatch(fullscreen, /Array\.from\(\{ length: nLat/);
});
