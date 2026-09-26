import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OVERVIEW_GLOBE,
  OVERVIEW_LAYOUT,
  desktopSceneWidth,
  shouldUseCompactOverview,
} from './overviewVisualContract.js';
import { OBSERVATORY_LAYOUT } from './observatoryLayout.js';

test('the observatory has one shared desktop contract instead of two fixed rails', () => {
  // 观测台不再有左右固定栏：布局常量只保留导航高度、面板宽度与两档基准。
  assert.equal(OVERVIEW_LAYOUT.leftWidth, undefined);
  assert.equal(OVERVIEW_LAYOUT.rightWidth, undefined);
  assert.equal(OVERVIEW_LAYOUT.navbarHeight, 70);
  assert.equal(OVERVIEW_LAYOUT.panelWidth, OBSERVATORY_LAYOUT.panelWidth);
  assert.equal(OVERVIEW_LAYOUT.toolbarHeight, OBSERVATORY_LAYOUT.toolbarHeight);
  assert.equal(OVERVIEW_LAYOUT.timelineHeight, OBSERVATORY_LAYOUT.timelineHeight);
  // 画布可用宽度只扣工作区外边距，不再按 viewport 减栏宽推算。
  assert.equal(desktopSceneWidth(1280), 1280 - 2 * OVERVIEW_LAYOUT.gutter);
  assert.equal(desktopSceneWidth(1280, 32), 1248);
});

test('overview switches to document flow before the scene becomes unusable', () => {
  assert.equal(shouldUseCompactOverview(1023), true);
  assert.equal(shouldUseCompactOverview(1024), false);
  assert.equal(shouldUseCompactOverview(1440, 500), true);
  assert.equal(shouldUseCompactOverview(1440, 700), false);
});

test('overview globe presentation has shared particle and material defaults', () => {
  assert.equal(OVERVIEW_GLOBE.particleDensity, 120);
  assert.equal(OVERVIEW_GLOBE.particleSize, 0.01);
  assert.equal(OVERVIEW_GLOBE.pointParticleSize, 0.024);
  assert.equal(OVERVIEW_GLOBE.lightingMode, 'fixed');
});
