import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildGridParticleSamples,
  updateGridParticleBuffers,
} from './sphericalFieldParticles.js';

const colorMapper = (_mode, _colormap, t) => [t, 1 - t, 0.25];

test('grid particle samples are deterministic and reusable for compatible fields', () => {
  const field = [
    [0, 1],
    [2, 3],
  ];

  const first = buildGridParticleSamples(field, { particleDensity: 3, seed: 42 });
  const second = buildGridParticleSamples(field, { particleDensity: 3, seed: 42 });

  assert.equal(first.signature, 'grid:2x2:3:0');
  assert.equal(first.count, 12);
  assert.deepEqual(first.latitudes, second.latitudes);
  assert.deepEqual(first.longitudes, second.longitudes);
  assert.deepEqual(first.radiusJitter, second.radiusJitter);
});

test('grid particle samples precompute interpolation cells and weights', () => {
  const samples = buildGridParticleSamples([
    [0, 1],
    [2, 3],
  ], { particleDensity: 1, seed: 11 });

  assert.equal(samples.cellIndexes.length, samples.count * 4);
  assert.equal(samples.cellWeights.length, samples.count * 4);

  for (let i = 0; i < samples.count; i += 1) {
    const offset = i * 4;
    const weightTotal = samples.cellWeights[offset]
      + samples.cellWeights[offset + 1]
      + samples.cellWeights[offset + 2]
      + samples.cellWeights[offset + 3];
    assert.ok(Math.abs(weightTotal - 1) < 0.0001);
  }
});

test('grid particle samples honor supplied geographic axes', () => {
  const samples = buildGridParticleSamples([
    [0, 1],
    [2, 3],
  ], {
    particleDensity: 1,
    seed: 11,
    latCenters: [87.5, 82.5],
    lonCenters: [-180, -175],
  });
  assert.equal(samples.signature.includes(':87.5,82.5:-180,-175'), true);
  assert.ok(Array.from(samples.latitudes).every((value) => value >= 80 && value <= 90));
  assert.ok(Array.from(samples.longitudes).every((value) => value >= -183 && value <= -172));
});

test('grid particle buffers update typed arrays in place across concentration frames', () => {
  const samples = buildGridParticleSamples([
    [0, 1],
    [2, 3],
  ], { particleDensity: 2, seed: 7 });
  const positions = new Float32Array(samples.count * 3);
  const colors = new Float32Array(samples.count * 3);

  updateGridParticleBuffers({
    samples,
    fieldData: { field: [[0, 1], [2, 3]], minVal: 0, maxVal: 3 },
    colorMode: 'inferno',
    colormap: 'inferno',
    positions,
    colors,
    colorMapper,
  });
  const samePositions = positions;
  const sameColors = colors;
  const firstY = positions[1];
  const firstR = colors[0];

  updateGridParticleBuffers({
    samples,
    fieldData: { field: [[3, 2], [1, 0]], minVal: 0, maxVal: 3 },
    colorMode: 'inferno',
    colormap: 'inferno',
    positions,
    colors,
    colorMapper,
  });

  assert.equal(positions, samePositions);
  assert.equal(colors, sameColors);
  assert.notEqual(positions[1], firstY);
  assert.notEqual(colors[0], firstR);
});
