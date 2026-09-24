import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRegionalParticleGeometry,
  updateRegionalParticlePositions,
} from './sphericalRegionalParticles.js';
import { cartesianToGeographic, updateRegionalCellColors } from './sphericalRegionalGrid.js';

test('regional particles stay in their true cells, use fixed radius and preserve cell values', () => {
  const spec = { latCenters: [-45, 45], lonCenters: [-90, 90], latBounds: [-90, 90], lonBounds: [-180, 180], particleDensity: 20, radius: 0.9 };
  const built = buildRegionalParticleGeometry(spec);
  assert.deepEqual(built, buildRegionalParticleGeometry(spec));
  assert.equal(built.vertexCount, 80);
  for (let vertex = 0; vertex < built.vertexCount; vertex += 1) {
    const xyz = built.positions.subarray(vertex * 3, vertex * 3 + 3);
    const { lat, lon } = cartesianToGeographic(...xyz);
    const cell = built.cellIndexByVertex[vertex];
    assert.ok(Math.abs(Math.hypot(...xyz) - 0.9) < 1e-6);
    assert.equal(lat > 0, cell >= 2);
    assert.equal(lon > 0, cell % 2 === 1);
  }
  const colors = updateRegionalCellColors({ geometry: built, values: [0, 1, 2, 3], colorRange: { min: 0, max: 3 }, colorMapper: t => [255 * t, 0, 0] });
  assert.equal(colors[0], 0);
  assert.equal(colors.at(-3), 1);
});

test('regional particle geometry never fills outside regional coverage', () => {
  const built = buildRegionalParticleGeometry({ latCenters: [10, 20], lonCenters: [100, 110], latBounds: [5, 25], lonBounds: [95, 115] });
  for (let i = 0; i < built.positions.length; i += 3) {
    const { lat, lon } = cartesianToGeographic(...built.positions.subarray(i, i + 3));
    assert.ok(lat >= 5 && lat <= 25);
    assert.ok(lon >= 95 && lon <= 115);
  }
});

test('regional particle height follows normalized concentration like Mars particles', () => {
  const built = buildRegionalParticleGeometry({
    latCenters: [-45, 45],
    lonCenters: [-90, 90],
    latBounds: [-90, 90],
    lonBounds: [-180, 180],
    particleDensity: 4,
    radius: 0.872,
  });
  const positions = built.positions.slice();
  updateRegionalParticlePositions({
    geometry: built,
    values: [0, 0, 0, 0],
    colorRange: { min: 0, max: 3 },
    positions,
    baseRadius: 0.872,
    heightScale: 0.225,
  });
  for (let vertex = 0; vertex < built.vertexCount; vertex += 1) {
    const offset = vertex * 3;
    assert.ok(Math.abs(Math.hypot(...positions.subarray(offset, offset + 3)) - 0.872) < 1e-6);
  }
  updateRegionalParticlePositions({ geometry: built, values: [3, 3, 3, 3], colorRange: { min: 0, max: 3 }, positions });
  for (let offset = 0; offset < positions.length; offset += 3) {
    assert.ok(Math.abs(Math.hypot(...positions.subarray(offset, offset + 3)) - 1.097) < 1e-6);
  }
});

test('visual particle heights and colours vary continuously across true cell boundaries', () => {
  const built = buildRegionalParticleGeometry({
    latCenters: [-2.5, 2.5], lonCenters: [-2.5, 2.5],
    latBounds: [-5, 5], lonBounds: [-5, 5], particleDensity: 40, radius: 0.9,
  });
  const original = built.positions.slice();
  const values = [-10, 10, -10, 10];
  const colors = new Float32Array(built.vertexCount * 3);
  updateRegionalParticlePositions({
    geometry: built, values, colorRange: { min: -10, max: 10 },
    positions: built.positions, colors, colorMapper: (t) => [255 * t, 0, 0],
  });
  for (let offset = 0; offset < original.length; offset += 3) {
    const before = cartesianToGeographic(...original.subarray(offset, offset + 3));
    const after = cartesianToGeographic(...built.positions.subarray(offset, offset + 3));
    const t = (Math.max(-2.5, Math.min(2.5, before.lon)) + 2.5) / 5;
    const radius = Math.hypot(...built.positions.subarray(offset, offset + 3));
    assert.ok(Math.abs(radius - (0.9 + t * 0.225)) < 1e-6, `stepped radius at longitude ${before.lon}`);
    assert.ok(Math.abs(colors[offset] - t) < 1e-6, 'colour and height must describe the same visual value');
    assert.ok(Math.abs(before.lat - after.lat) < 1e-5);
    assert.ok(Math.abs(before.lon - after.lon) < 1e-5);
  }
  assert.deepEqual(values, [-10, 10, -10, 10], 'visual interpolation must not overwrite raw readings');
});

test('a global visual field joins the dateline and converges to one value at each pole', () => {
  const built = buildRegionalParticleGeometry({
    latCenters: [-89.5, 0, 89.5], lonCenters: [-135, -45, 45, 135],
    latBounds: [-90, 90], lonBounds: [-180, 180], particleDensity: 120, radius: 0.9,
  });
  const initial = built.positions.slice();
  updateRegionalParticlePositions({
    geometry: built, values: [0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1],
    colorRange: { min: 0, max: 1 }, positions: built.positions,
  });
  let seamSamples = 0;
  let polarSamples = 0;
  for (let offset = 0; offset < initial.length; offset += 3) {
    const { lat, lon } = cartesianToGeographic(...initial.subarray(offset, offset + 3));
    const t = (Math.hypot(...built.positions.subarray(offset, offset + 3)) - 0.9) / 0.225;
    if (Math.abs(lon) > 179) {
      assert.ok(Math.abs(t - 0.5) < 1 / 90 + 1e-5, 'no height jump at the dateline');
      seamSamples += 1;
    }
    if (Math.abs(lat) > 89.5) {
      assert.ok(Math.abs(t - 0.5) <= (90 - Math.abs(lat)) + 1e-5, 'polar heights converge instead of forming wedges');
      polarSamples += 1;
    }
  }
  assert.ok(seamSamples > 0);
  assert.ok(polarSamples > 0);
});
