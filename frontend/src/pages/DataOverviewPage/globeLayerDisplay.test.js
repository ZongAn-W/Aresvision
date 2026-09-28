import test from 'node:test';
import assert from 'node:assert/strict';
import { canEnableAnomaly, convertAnomalyValue, transformSceneModelAnomaly } from './globeLayerDisplay.js';

test('anomaly transformation replaces single MCD values with zero-centred deltas', () => {
  const scene = {
    renderMode: 'single',
    layers: [{ source: 'mcd', points: [{ lat: 0, lng: 0, val: 10 }, { lat: 5, lng: 0, val: 14 }], minVal: 10, maxVal: 14 }],
    colorMode: 'inferno',
  };
  assert.equal(canEnableAnomaly(scene), true);
  const transformed = transformSceneModelAnomaly(scene);
  assert.equal(transformed.colorMode, 'rdbu');
  assert.deepEqual(transformed.layers[0].points.map((point) => Math.round(point.val)), [-2, 2]);
  assert.equal(Math.round(transformed.layers[0].minVal), -2);
  assert.equal(Math.round(transformed.layers[0].maxVal), 2);
});

test('anomaly is unavailable for multi-source and difference scenes', () => {
  assert.equal(canEnableAnomaly({ renderMode: 'multi-source', layers: [{ source: 'mcd' }, { source: 'openmars' }] }), false);
  assert.equal(canEnableAnomaly({ renderMode: 'diff', layers: [{ source: 'MCD-OpenMARS' }] }), false);
});

test('temperature anomaly keeps delta units when displaying Celsius', () => {
  assert.equal(convertAnomalyValue(4, 'Temperature', { temperature: 'C' }), 4);
});
