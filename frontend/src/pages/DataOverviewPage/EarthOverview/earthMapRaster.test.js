import test from 'node:test';
import assert from 'node:assert/strict';
import { drawEarthRaster } from './earthMapRaster.js';

function field(height, width) {
  return {
    lat: Array.from({ length: height }, (_, row) => -90 + (row + .5) * 180 / height),
    lon: Array.from({ length: width }, (_, col) => -180 + (col + .5) * 360 / width),
    field: Array.from({ length: height }, () => Array(width).fill(300)),
    coverage: { latitude_range: [-90, 90], longitude_range: [-180, 180] },
    color_range: { min: 200, max: 400 },
  };
}

test('full 240x480 raster uses bounded draw calls and covers both longitude boundaries', () => {
  let first, last, calls = 0, cleared = 0;
  const context = {
    clearRect: () => { cleared += 1; },
    fillRect: (...rectangle) => { first ??= rectangle; last = rectangle; calls += 1; },
  };
  assert.equal(drawEarthRaster(context, field(240, 480)), 115200);
  assert.equal(calls, 115200);
  assert.equal(cleared, 1);
  assert.deepEqual(first, [0, 717, 3, 3]);
  assert.deepEqual(last, [1437, 0, 3, 3]);
});

test('display reduction draws 7200 cells and leaves missing values transparent', () => {
  const payload = field(60, 120);
  payload.field[0][0] = null;
  payload.field[1][1] = NaN;
  let calls = 0;
  const context = { clearRect: () => {}, fillRect: () => { calls += 1; } };
  assert.equal(drawEarthRaster(context, payload), 7198);
  assert.equal(calls, 7198);
  assert.equal(drawEarthRaster(context, null), 0);
});
