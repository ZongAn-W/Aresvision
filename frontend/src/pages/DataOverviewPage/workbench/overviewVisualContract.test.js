import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OVERVIEW_GLOBE,
  OVERVIEW_LAYOUT,
  desktopSceneWidth,
  shouldUseCompactOverview,
} from './overviewVisualContract.js';

test('overview rails have one shared desktop contract', () => {
  assert.equal(OVERVIEW_LAYOUT.leftWidth, 300);
  assert.equal(OVERVIEW_LAYOUT.rightWidth, 540);
  assert.equal(desktopSceneWidth(1280), 440);
  assert.equal(desktopSceneWidth(1280, 320, 560), 400);
});

test('overview switches to compact layout before the scene becomes unusable', () => {
  assert.equal(shouldUseCompactOverview(1120), true);
  assert.equal(shouldUseCompactOverview(1121), false);
});

test('overview globe presentation has shared particle and material defaults', () => {
  assert.equal(OVERVIEW_GLOBE.particleDensity, 120);
  assert.equal(OVERVIEW_GLOBE.particleSize, 0.01);
  assert.equal(OVERVIEW_GLOBE.pointParticleSize, 0.024);
  assert.equal(OVERVIEW_GLOBE.lightingMode, 'fixed');
});
